import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import {
  isScannerSignatureId,
  type AddSignatureRequest,
  type PasteSignaturesRequest,
  type PasteSignaturesResult,
  type UpdateSignatureRequest,
} from '@darkbeacon/shared';
import type { Signature } from '../domain/map.js';
import { signatureTypeCode } from '../domain/intel.js';
import { changes, compactSignature, defined } from '../domain/rules.js';
import { signatureKey } from '../domain/stamps.js';
import { parseSignaturePaste } from '../domain/signature-paste.js';
import { MappingUseCases, type EventBatch } from './base.js';

/** Signatures belong to a visible system; a hidden system's signatures are kept but unreachable. */
export class SignatureUseCases extends MappingUseCases {
  async list(actor: Actor | null, mapId: string, solarSystemId: number): Promise<Signature[]> {
    await this.authorize(actor, mapId, 'viewer');
    const merged = await this.ports.overlay?.view(mapId);
    if (merged) {
      if (!merged.systems.some((s) => s.solarSystemId === solarSystemId)) throw new NotFoundError('System');
      return merged.signatures.filter((s) => s.solarSystemId === solarSystemId);
    }
    await this.visibleSystem(mapId, solarSystemId);
    return this.ports.signatures.listForSystem(mapId, solarSystemId);
  }

  async add(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: AddSignatureRequest,
  ): Promise<Signature> {
    const who = await this.authorizeEdit(actor, mapId);
    if (!request.custom && !isScannerSignatureId(request.eveId))
      throw new ValidationError('expected ABC-123 (or mark the entry as custom)');
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const existing = await this.ports.signatures.listForSystem(mapId, solarSystemId);
      if (existing.some((s) => s.eveId === request.eveId))
        throw new ConflictError(`Signature ${request.eveId} already exists`);
      const now = this.ports.clock.now();
      const signature: Signature = compactSignature({
        id: newId(),
        mapId,
        solarSystemId,
        eveId: request.eveId,
        group: request.group ?? 'unknown',
        type: request.type ?? null,
        name: request.name ?? null,
        description: request.description ?? '',
        connectionId: null,
        kind: request.kind ?? 'signature',
        custom: request.custom ?? false,
        createdAt: now,
        updatedAt: now,
      });
      await this.ports.signatures.insert(signature);
      events.add('signature.added', signature);
      return signature;
    });
  }

  /**
   * Linking a connection makes the signature a wormhole; the connection must touch its system. A
   * linked signature with a known wormhole type (not K162) gives the connection that type's size.
   */
  async update(
    actor: Actor | null,
    mapId: string,
    signatureId: string,
    request: UpdateSignatureRequest,
  ): Promise<Signature> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId, signatureId);
      const patch = defined(request);
      if (patch.kind === 'signature' && !current.kind) delete patch.kind;
      if (!changes(current, patch)) return current;
      // Scanner entries keep scanner ids; only custom entries take free text.
      if (patch.eveId && !current.custom && !isScannerSignatureId(patch.eveId))
        throw new ValidationError('expected ABC-123 (custom entries may use any id)');
      if (patch.eveId && patch.eveId !== current.eveId) {
        const siblings = await this.ports.signatures.listForSystem(mapId, current.solarSystemId);
        if (siblings.some((s) => s.eveId === patch.eveId))
          throw new ConflictError(`Signature ${patch.eveId} already exists`);
        // The old code is gone (a typo fixed): merged maps drop it everywhere.
        await this.tombstone(current, this.ports.clock.now());
      }
      if (patch.connectionId) {
        const connection = await this.ports.connections.findById(mapId, patch.connectionId);
        if (!connection) throw new ValidationError('Unknown connection');
        if (connection.source !== current.solarSystemId && connection.target !== current.solarSystemId)
          throw new ValidationError('The connection does not start or end in this system');
        patch.group = 'wormhole';
      }
      const next: Signature = compactSignature({ ...current, ...patch, updatedAt: this.ports.clock.now() });
      await this.ports.signatures.update(next);
      events.add('signature.updated', next, current);
      if (patch.connectionId !== undefined || patch.type !== undefined) await this.inheritType(next, events);
      return next;
    });
  }

  /** Sets the size of the signature's connection from its wormhole type's max jump mass. */
  private async inheritType(signature: Signature, events: EventBatch): Promise<void> {
    const code = signatureTypeCode(signature);
    if (!signature.connectionId || !code || code === 'K162') return;
    const size = this.ports.universe.wormholeType(code)?.shipSize;
    const connection = await this.ports.connections.findById(signature.mapId, signature.connectionId);
    if (!size || !connection || connection.type !== 'wormhole' || connection.shipSize === size) return;
    const next = { ...connection, shipSize: size, updatedAt: this.ports.clock.now() };
    await this.ports.connections.update(next);
    events.add('connection.updated', next, connection);
  }

  async remove(actor: Actor | null, mapId: string, signatureId: string): Promise<void> {
    const who = await this.authorizeEdit(actor, mapId);
    await this.write(who, mapId, async (events) => {
      const signature = await this.load(mapId, signatureId);
      await this.tombstone(signature, this.ports.clock.now());
      await this.ports.signatures.delete(mapId, signatureId);
      events.add(
        'signature.removed',
        { id: signature.id, solarSystemId: signature.solarSystemId },
        signature,
      );
    });
  }

  /**
   * Applies a probe scanner paste. New ids are added; known ids gain group and name when the
   * paste knows more, never less. `replace` also removes signatures missing from the paste,
   * unless nothing in the paste was understood.
   */
  async paste(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: PasteSignaturesRequest,
  ): Promise<PasteSignaturesResult> {
    const who = await this.authorizeEdit(actor, mapId);
    const parsed = parseSignaturePaste(request.text);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const existing = new Map(
        (await this.ports.signatures.listForSystem(mapId, solarSystemId)).map((s) => [s.eveId, s]),
      );
      const now = this.ports.clock.now();
      const result: PasteSignaturesResult = { added: 0, updated: 0, removed: 0, skipped: parsed.skipped };

      for (const found of parsed.signatures) {
        const current = existing.get(found.eveId);
        existing.delete(found.eveId);
        if (!current) {
          const signature: Signature = compactSignature({
            id: newId(),
            mapId,
            solarSystemId,
            eveId: found.eveId,
            group: found.group,
            type: found.type,
            name: found.name,
            description: '',
            connectionId: null,
            kind: found.kind,
            createdAt: now,
            updatedAt: now,
          });
          await this.ports.signatures.insert(signature);
          events.add('signature.added', signature);
          result.added++;
          continue;
        }
        const patch: Partial<Signature> = {};
        if (found.group !== 'unknown') patch.group = found.group;
        if (found.name) patch.name = found.name;
        if (found.kind !== (current.kind ?? 'signature')) patch.kind = found.kind;
        if (!changes(current, patch)) continue;
        const next = compactSignature({ ...current, ...patch, updatedAt: now });
        await this.ports.signatures.update(next);
        events.add('signature.updated', next, current);
        result.updated++;
      }

      if (request.mode === 'replace' && parsed.signatures.length > 0) {
        // Only kinds the paste lists: a paste without anomalies (filtered in the game) keeps them.
        // Custom entries were never on the scanner and stay.
        const kinds = new Set(parsed.signatures.map((p) => p.kind));
        for (const stale of existing.values()) {
          if (stale.custom || !kinds.has(stale.kind ?? 'signature')) continue;
          await this.tombstone(stale, now);
          await this.ports.signatures.delete(mapId, stale.id);
          events.add('signature.removed', { id: stale.id, solarSystemId }, stale);
          result.removed++;
        }
      }
      return result;
    });
  }

  /** Records a deletion, so maps merging this one drop older copies of the signature too. */
  private tombstone(signature: Signature, at: number): Promise<void> {
    return this.ports.stamps.putTombstone(
      signature.mapId,
      'signature',
      signatureKey(signature.solarSystemId, signature.eveId),
      at,
    );
  }

  /** A signature of a visible system. */
  private async load(mapId: string, signatureId: string): Promise<Signature> {
    const signature = await this.ports.signatures.findById(mapId, signatureId);
    if (!signature) throw new NotFoundError('Signature');
    await this.visibleSystem(mapId, signature.solarSystemId).catch(() => {
      throw new NotFoundError('Signature');
    });
    return signature;
  }
}
