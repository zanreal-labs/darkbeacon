import { ConflictError, NotFoundError, ValidationError, newId, type Actor } from '@darkbeacon/core';
import {
  DEFAULT_SIGNATURE_RETENTION_DAYS,
  isScannerSignatureId,
  type AddSignatureRequest,
  type AuthorDto,
  type PasteSignaturesRequest,
  type PasteSignaturesResult,
  type RemovedSignaturesDto,
  type RemoveSignaturesRequest,
  type SignatureDto,
  type UpdateSignatureRequest,
} from '@darkbeacon/shared';
import type { Connection, Signature } from '../domain/map.js';
import { signatureTypeCode } from '../domain/intel.js';
import { changes, compactSignature, defined } from '../domain/rules.js';
import { pairKey, signatureKey } from '../domain/stamps.js';
import { parseSignaturePaste } from '../domain/signature-paste.js';
import { MappingUseCases, type EventBatch } from './base.js';
import { renumberBookmarks } from './bookmark-numbers.js';
import { patchConnection } from './connections.js';
import { removeConnection } from './systems.js';

const DAY = 24 * 60 * 60 * 1000;
/** A scan that sees an unchanged signature again keeps it alive (see `sweep`) at most this often. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;
const SWEEPER: Actor = { kind: 'system', id: 'signature-sweep' };

/** Fields a new signature starts with besides its id, code and group. */
function blank(): Pick<
  Signature,
  'tempName' | 'destination' | 'timeStatus' | 'massStatus' | 'bubbled' | 'createdBy' | 'updatedBy'
> {
  return {
    tempName: null,
    destination: null,
    timeStatus: null,
    massStatus: null,
    bubbled: false,
    createdBy: null,
    updatedBy: null,
  };
}

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
    const author = await this.author(who);
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
        ...blank(),
        tempName: request.tempName ?? null,
        destination: request.destination ?? null,
        timeStatus: request.timeStatus ?? null,
        massStatus: request.massStatus ?? null,
        bubbled: request.bubbled ?? false,
        createdBy: author,
        updatedBy: author,
      });
      await this.ports.signatures.insert(signature);
      events.add('signature.added', signature);
      return signature;
    });
  }

  /**
   * Linking a connection makes the signature a wormhole; the connection must touch its system.
   * A linked signature hands the connection what it knows (see `pushToConnection`) and its
   * temporary name to the system it leads to. Another signature of the same system that led
   * through that connection is unlinked: one signature per end.
   */
  async update(
    actor: Actor | null,
    mapId: string,
    signatureId: string,
    request: UpdateSignatureRequest,
  ): Promise<Signature> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    return this.write(who, mapId, async (events) => {
      const current = await this.load(mapId, signatureId);
      const patch = defined(request) as Partial<Signature>;
      if (patch.kind === 'signature' && !current.kind) delete patch.kind;
      if (!changes(current, patch)) return current;
      // Scanner entries keep scanner ids; only custom entries take free text.
      if (patch.eveId && !current.custom && !isScannerSignatureId(patch.eveId))
        throw new ValidationError('expected ABC-123 (custom entries may use any id)');
      const now = this.ports.clock.now();
      if (patch.eveId && patch.eveId !== current.eveId) {
        const siblings = await this.ports.signatures.listForSystem(mapId, current.solarSystemId);
        if (siblings.some((s) => s.eveId === patch.eveId))
          throw new ConflictError(`Signature ${patch.eveId} already exists`);
        // The old code is gone (a typo fixed): merged maps drop it everywhere.
        await this.tombstone(current, now);
      }
      if (patch.connectionId) {
        const connection = await this.ports.connections.findById(mapId, patch.connectionId);
        if (!connection) throw new ValidationError('Unknown connection');
        if (connection.source !== current.solarSystemId && connection.target !== current.solarSystemId)
          throw new ValidationError('The connection does not start or end in this system');
        patch.group = 'wormhole';
      }
      const linked = patch.connectionId !== undefined && patch.connectionId !== current.connectionId;
      const next: Signature = compactSignature({ ...current, ...patch, updatedAt: now, updatedBy: author });
      await this.ports.signatures.update(next);
      events.add('signature.updated', next, current);
      if (!next.connectionId) return next;

      if (linked) await this.unlinkOthers(next, events, now);
      const pushed = await this.pushToConnection(next, events, now, {
        size: linked || patch.type !== undefined,
        time: linked || patch.timeStatus !== undefined,
        mass: linked || patch.massStatus !== undefined,
      });
      if (linked || patch.tempName !== undefined) await this.nameTarget(pushed, events, now);
      return pushed;
    });
  }

  async remove(actor: Actor | null, mapId: string, signatureId: string): Promise<void> {
    await this.authorizeEdit(actor, mapId);
    const signature = await this.load(mapId, signatureId);
    await this.removeMany(actor, mapId, signature.solarSystemId, { ids: [signatureId] });
  }

  /**
   * Removes signatures of one system and returns them as they were (for an undo).
   * `withConnections`: the connections they lead through go too (with the far side's signatures
   * of them). `backLinks`: the far side's signature of the connection goes too, when it is the
   * only one there and no other signature here leads through that connection.
   */
  async removeMany(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: RemoveSignaturesRequest,
  ): Promise<RemovedSignaturesDto> {
    const who = await this.authorizeEdit(actor, mapId);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const now = this.ports.clock.now();
      const here = await this.ports.signatures.listForSystem(mapId, solarSystemId);
      const ids = new Set(request.ids);
      const doomed = here.filter((s) => ids.has(s.id));
      if (doomed.length !== ids.size) throw new NotFoundError('Signature');
      const removed: Signature[] = [];
      const connectionIds: string[] = [];
      const drop = async (signature: Signature) => {
        await this.tombstone(signature, now);
        await this.ports.signatures.delete(mapId, signature.id);
        events.add(
          'signature.removed',
          { id: signature.id, solarSystemId: signature.solarSystemId },
          signature,
        );
        removed.push(signature);
      };

      for (const signature of doomed) await drop(signature);
      for (const signature of doomed) {
        if (!signature.connectionId || connectionIds.includes(signature.connectionId)) continue;
        const connection = await this.ports.connections.findById(mapId, signature.connectionId);
        if (!connection) continue;
        const farId = connection.source === solarSystemId ? connection.target : connection.source;
        const far = (await this.ports.signatures.listForSystem(mapId, farId)).filter(
          (s) => s.connectionId === connection.id,
        );
        const sameSide = here.filter(
          (s) => !ids.has(s.id) && s.connectionId === connection.id && s.id !== signature.id,
        );
        // A locked connection stays (only a manager removes it, from the connection itself).
        if (request.withConnections && !connection.locked) {
          for (const back of far) await drop(back);
          await this.ports.stamps.putTombstone(
            mapId,
            'connection',
            pairKey(connection.source, connection.target),
            now,
          );
          await removeConnection(this.ports, events, connection);
          connectionIds.push(connection.id);
        } else if (request.backLinks && far.length === 1 && sameSide.length === 0) {
          await drop(far[0]!);
        }
      }
      if (connectionIds.length > 0) await renumberBookmarks(this.ports, events, mapId);
      return { signatures: removed, connectionIds };
    });
  }

  /**
   * Puts removed signatures back as they were (an undo): same id, code, fields and author. A
   * signature whose code is in use again in its system, or whose system is gone, is skipped; a
   * link to a connection that is gone is dropped.
   */
  async restore(
    actor: Actor | null,
    mapId: string,
    signatures: readonly SignatureDto[],
  ): Promise<Signature[]> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    return this.write(who, mapId, async (events) => {
      const now = this.ports.clock.now();
      const restored: Signature[] = [];
      for (const removed of signatures) {
        const system = await this.ports.systems.find(mapId, removed.solarSystemId);
        if (!system?.visible) continue;
        const siblings = await this.ports.signatures.listForSystem(mapId, removed.solarSystemId);
        if (siblings.some((s) => s.eveId === removed.eveId || s.id === removed.id)) continue;
        if (await this.ports.signatures.findById(mapId, removed.id)) continue;
        const connection = removed.connectionId
          ? await this.ports.connections.findById(mapId, removed.connectionId)
          : null;
        const touches =
          connection &&
          (connection.source === removed.solarSystemId || connection.target === removed.solarSystemId);
        const { provenance: _provenance, ...fields } = removed;
        const signature: Signature = compactSignature({
          ...blank(),
          ...fields,
          mapId,
          connectionId: touches ? connection.id : null,
          updatedAt: now,
          updatedBy: author,
        });
        await this.ports.signatures.insert(signature, { restoredAt: now });
        events.add('signature.added', signature);
        restored.push(signature);
      }
      return restored;
    });
  }

  /**
   * Applies a probe scanner paste. New ids are added; known ids gain group and name when the
   * paste knows more, never less. `replace` also removes signatures missing from the paste,
   * unless nothing in the paste was understood; they are returned for an undo. A signature seen
   * again counts as fresh for the sweep of old signatures.
   */
  async paste(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: PasteSignaturesRequest,
  ): Promise<PasteSignaturesResult> {
    const who = await this.authorizeEdit(actor, mapId);
    const author = await this.author(who);
    const parsed = parseSignaturePaste(request.text);
    return this.write(who, mapId, async (events) => {
      await this.visibleSystem(mapId, solarSystemId);
      const existing = new Map(
        (await this.ports.signatures.listForSystem(mapId, solarSystemId)).map((s) => [s.eveId, s]),
      );
      const now = this.ports.clock.now();
      const result: PasteSignaturesResult = { added: 0, updated: 0, removed: 0, skipped: parsed.skipped };
      const seen: string[] = [];

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
            ...blank(),
            createdBy: author,
            updatedBy: author,
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
        if (!changes(current, patch)) {
          if (now - current.updatedAt > TOUCH_AFTER_MS) seen.push(current.id);
          continue;
        }
        const next = compactSignature({ ...current, ...patch, updatedAt: now, updatedBy: author });
        await this.ports.signatures.update(next);
        events.add('signature.updated', next, current);
        result.updated++;
      }
      if (seen.length > 0) await this.ports.signatures.touch(mapId, seen, now);

      if (request.mode === 'replace' && parsed.signatures.length > 0) {
        result.removedSignatures = [];
        // Only kinds the paste lists: a paste without anomalies (filtered in the game) keeps them.
        // Custom entries were never on the scanner and stay.
        const kinds = new Set(parsed.signatures.map((p) => p.kind));
        for (const stale of existing.values()) {
          if (stale.custom || !kinds.has(stale.kind ?? 'signature')) continue;
          await this.tombstone(stale, now);
          await this.ports.signatures.delete(mapId, stale.id);
          events.add('signature.removed', { id: stale.id, solarSystemId }, stale);
          result.removed++;
          result.removedSignatures.push(stale);
        }
      }
      return result;
    });
  }

  /**
   * Removes signatures nobody changed or scanned again for the map's retention (14 days unless the
   * map says otherwise; 0 keeps them), as the server. Returns how many went.
   */
  async sweep(): Promise<number> {
    const now = this.ports.clock.now();
    // The shortest retention is a day; each map's own is checked below.
    const candidates = await this.ports.signatures.listUpdatedBefore(now - DAY);
    const byMap = new Map<string, Signature[]>();
    for (const s of candidates) byMap.set(s.mapId, [...(byMap.get(s.mapId) ?? []), s]);
    let count = 0;
    for (const [mapId, signatures] of byMap) {
      const map = await this.ports.maps.findById(mapId);
      const days = map?.settings.signatureRetentionDays ?? DEFAULT_SIGNATURE_RETENTION_DAYS;
      if (!map || days === 0) continue;
      const stale = signatures.filter((s) => s.updatedAt < now - days * DAY);
      if (stale.length === 0) continue;
      count += await this.write(SWEEPER, mapId, async (events) => {
        let removed = 0;
        for (const signature of stale) {
          const system = await this.ports.systems.find(mapId, signature.solarSystemId);
          await this.tombstone(signature, now);
          await this.ports.signatures.delete(mapId, signature.id);
          // A hidden system's signatures go quietly, as everything about it.
          if (system?.visible)
            events.add(
              'signature.removed',
              { id: signature.id, solarSystemId: signature.solarSystemId },
              signature,
            );
          removed++;
        }
        return removed;
      });
    }
    return count;
  }

  /**
   * Hands the connection what the signature knows: its ship size from the wormhole type, lifetime
   * and mass. A K162 (or untyped signature) takes the size, and lifetime and mass where set, from
   * the signature on the far side (the hole's forward side); what it took is written back on it,
   * so both sides read the same.
   */
  private async pushToConnection(
    signature: Signature,
    events: EventBatch,
    now: number,
    fields: { size: boolean; time: boolean; mass: boolean },
  ): Promise<Signature> {
    const connection = signature.connectionId
      ? await this.ports.connections.findById(signature.mapId, signature.connectionId)
      : null;
    // A locked connection keeps what it says.
    if (!connection || connection.type !== 'wormhole' || connection.locked) return signature;
    const sizeOf = (s: Signature) => {
      const code = signatureTypeCode(s);
      return code && code !== 'K162' ? (this.ports.universe.wormholeType(code)?.shipSize ?? null) : null;
    };
    let size = sizeOf(signature);
    let time = signature.timeStatus ?? null;
    let mass = signature.massStatus ?? null;
    if (!size) {
      const farId = connection.source === signature.solarSystemId ? connection.target : connection.source;
      const forward = (await this.ports.signatures.listForSystem(signature.mapId, farId)).find(
        (s) => s.connectionId === connection.id && sizeOf(s),
      );
      if (forward) {
        size = sizeOf(forward);
        time = forward.timeStatus ?? time;
        mass = forward.massStatus ?? mass;
      }
    }
    const patch: Partial<Connection> = {};
    if (fields.size && size && size !== connection.shipSize) patch.shipSize = size;
    if (fields.time && time && time !== connection.timeStatus) patch.timeStatus = time;
    if (fields.mass && mass && mass !== connection.massStatus) patch.massStatus = mass;
    if (Object.keys(patch).length > 0) {
      const next = patchConnection(connection, patch, now);
      await this.ports.connections.update(next);
      events.add('connection.updated', next, connection);
    }
    const mirror: Partial<Signature> = {};
    if (time && time !== signature.timeStatus) mirror.timeStatus = time;
    if (mass && mass !== signature.massStatus) mirror.massStatus = mass;
    if (Object.keys(mirror).length === 0) return signature;
    const mirrored = { ...signature, ...mirror };
    await this.ports.signatures.update(mirrored);
    events.add('signature.updated', mirrored, signature);
    return mirrored;
  }

  /** The system a linked signature leads to takes its temporary name. */
  private async nameTarget(signature: Signature, events: EventBatch, now: number): Promise<void> {
    if (!signature.tempName || !signature.connectionId) return;
    const connection = await this.ports.connections.findById(signature.mapId, signature.connectionId);
    if (!connection) return;
    const targetId = connection.source === signature.solarSystemId ? connection.target : connection.source;
    const target = await this.ports.systems.find(signature.mapId, targetId);
    if (!target?.visible || target.temporaryName === signature.tempName) return;
    const next = { ...target, temporaryName: signature.tempName, updatedAt: now };
    await this.ports.systems.update(next);
    events.add('system.updated', next, target);
  }

  /** Other signatures of the same system that led through the signature's connection. */
  private async unlinkOthers(signature: Signature, events: EventBatch, now: number): Promise<void> {
    for (const other of await this.ports.signatures.listForSystem(signature.mapId, signature.solarSystemId)) {
      if (other.id === signature.id || other.connectionId !== signature.connectionId) continue;
      const next = { ...other, connectionId: null, updatedAt: now };
      await this.ports.signatures.update(next);
      events.add('signature.updated', next, other);
    }
  }

  private async author(actor: Actor): Promise<AuthorDto | null> {
    return (await this.ports.authors?.author(actor)) ?? null;
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
