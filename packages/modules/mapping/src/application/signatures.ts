import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import type {
  AddSignatureRequest,
  PasteSignaturesRequest,
  PasteSignaturesResult,
  UpdateSignatureRequest,
} from '@darkbeacon/shared';
import type { Signature } from '../domain/map.js';
import { changes, defined } from '../domain/rules.js';
import { parseSignaturePaste } from '../domain/signature-paste.js';
import { MappingUseCases } from './base.js';

/** Signatures belong to a visible system; a hidden system's signatures are kept but unreachable. */
export class SignatureUseCases extends MappingUseCases {
  async list(actor: Actor | null, mapId: string, solarSystemId: number): Promise<Signature[]> {
    await this.authorize(actor, mapId, 'viewer');
    await this.visibleSystem(mapId, solarSystemId);
    return this.ports.signatures.listForSystem(mapId, solarSystemId);
  }

  async add(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: AddSignatureRequest,
  ): Promise<Signature> {
    const who = await this.authorize(actor, mapId, 'member');
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const existing = await this.ports.signatures.listForSystem(mapId, solarSystemId);
      if (existing.some((s) => s.eveId === request.eveId))
        throw new ConflictError(`Signature ${request.eveId} already exists`);
      const now = this.ports.clock.now();
      const signature: Signature = {
        id: newId(),
        mapId,
        solarSystemId,
        eveId: request.eveId,
        group: request.group ?? 'unknown',
        type: request.type ?? null,
        name: request.name ?? null,
        description: request.description ?? '',
        connectionId: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.ports.signatures.insert(signature);
      events.add('signature.added', signature);
      return signature;
    });
  }

  /** Linking a connection makes the signature a wormhole; the connection must touch its system. */
  async update(
    actor: Actor | null,
    mapId: string,
    signatureId: string,
    request: UpdateSignatureRequest,
  ): Promise<Signature> {
    const who = await this.authorize(actor, mapId, 'member');
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId, signatureId);
      const patch = defined(request);
      if (!changes(current, patch)) return current;
      if (patch.eveId && patch.eveId !== current.eveId) {
        const siblings = await this.ports.signatures.listForSystem(mapId, current.solarSystemId);
        if (siblings.some((s) => s.eveId === patch.eveId))
          throw new ConflictError(`Signature ${patch.eveId} already exists`);
      }
      if (patch.connectionId) {
        const connection = await this.ports.connections.findById(mapId, patch.connectionId);
        if (!connection) throw new ValidationError('Unknown connection');
        if (connection.source !== current.solarSystemId && connection.target !== current.solarSystemId)
          throw new ValidationError('The connection does not start or end in this system');
        patch.group = 'wormhole';
      }
      const next: Signature = { ...current, ...patch, updatedAt: this.ports.clock.now() };
      await this.ports.signatures.update(next);
      events.add('signature.updated', next);
      return next;
    });
  }

  async remove(actor: Actor | null, mapId: string, signatureId: string): Promise<void> {
    const who = await this.authorize(actor, mapId, 'member');
    await this.write(who, mapId, async (events) => {
      const signature = await this.load(mapId, signatureId);
      await this.ports.signatures.delete(mapId, signatureId);
      events.add('signature.removed', { id: signature.id, solarSystemId: signature.solarSystemId });
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
    const who = await this.authorize(actor, mapId, 'member');
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
          const signature: Signature = {
            id: newId(),
            mapId,
            solarSystemId,
            eveId: found.eveId,
            group: found.group,
            type: null,
            name: found.name,
            description: '',
            connectionId: null,
            createdAt: now,
            updatedAt: now,
          };
          await this.ports.signatures.insert(signature);
          events.add('signature.added', signature);
          result.added++;
          continue;
        }
        const patch: Partial<Signature> = {};
        if (found.group !== 'unknown') patch.group = found.group;
        if (found.name) patch.name = found.name;
        if (!changes(current, patch)) continue;
        const next = { ...current, ...patch, updatedAt: now };
        await this.ports.signatures.update(next);
        events.add('signature.updated', next);
        result.updated++;
      }

      if (request.mode === 'replace' && parsed.signatures.length > 0) {
        for (const stale of existing.values()) {
          await this.ports.signatures.delete(mapId, stale.id);
          events.add('signature.removed', { id: stale.id, solarSystemId });
          result.removed++;
        }
      }
      return result;
    });
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
