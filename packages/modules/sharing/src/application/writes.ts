import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  requireMapRole,
  type Actor,
  type AuditMapRef,
} from '@darkbeacon/core';
import {
  LOCAL_INSTANCE,
  type AddConnectionRequest,
  type AddSignatureRequest,
  type AddSystemRequest,
  type ChainObjectKind,
  type ConnectionType,
  type LogPassagesRequest,
  type MoveSystemsRequest,
  type PasteSignaturesRequest,
  type PasteSignaturesResult,
  type UpdateConnectionRequest,
  type UpdateSignatureRequest,
  type UpdateSystemRequest,
} from '@darkbeacon/shared';
import {
  connectionFields,
  labelNamesById,
  refusedFields,
  SCOPE_WORDS,
  scopeOfField,
  signatureFields,
  systemFields,
  type ChainCommand,
} from '../domain/commands.js';
import { connectionGroupOf, pairKey, refId, signatureKey, signatureKeyOf } from '../domain/keys.js';
import { passagesShared } from '../domain/passages.js';
import { objectAllowed } from '../domain/scopes.js';
import { SELF, type SourceInfo } from '../domain/view.js';
import type { ChainMerger } from './merger.js';
import type { SharingPorts } from './ports.js';

type MergedMapState = NonNullable<Awaited<ReturnType<ChainMerger['state']>>>;

/**
 * Changes made on a merged map. Nothing is stored on the merged map itself except its layout: a
 * change goes to the sources holding the object — the map's own objects and read-write shares —
 * through their ChainSource, cut to what each share lets the map see (what it cannot read it
 * cannot write). Objects only read-only sources hold cannot be changed here.
 */
export class ChainWrites {
  constructor(
    private readonly ports: SharingPorts,
    private readonly merger: ChainMerger,
  ) {}

  async addSystem(actor: Actor | null, mapId: string, request: AddSystemRequest): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const ref = refId('system', String(request.solarSystemId));
    if (map.merge.holders(ref).length === 0) {
      const [target] = this.newObjectTargets(map, 'system');
      if (!target) throw new ForbiddenError('No map this one merges takes new systems');
      await this.write(who, map, target, {
        op: 'system.add',
        key: String(request.solarSystemId),
        ...(request.position ? { hint: request.position } : {}),
      });
    }
    if (request.position)
      await this.merger.move(who, mapId, [
        { solarSystemId: request.solarSystemId, position: request.position },
      ]);
  }

  async updateSystem(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: UpdateSystemRequest,
  ): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const ref = refId('system', String(solarSystemId));
    if (map.merge.holders(ref).length === 0) throw new NotFoundError('System');
    const composite = map.info.kind === 'composite';
    const local = composite ? map.local.get(solarSystemId) : undefined;
    const unlocking = request.locked === false;
    if (local?.locked && !unlocking && (request.position || request.visible === false))
      throw new ConflictError('The system is locked');
    if (request.visible === false) {
      await this.removeSystem(who, mapId, solarSystemId);
      return;
    }
    // Labels cross by name: the merged map's own names of the ones picked.
    const fields = systemFields(request, (ids) => labelNamesById(ids, map.info.systemLabels ?? []));
    if (composite) {
      // Notes, Tags and locks of a composite are its own, kept over what its sources say.
      const own: Partial<{ notes: string | null; labelIds: string[]; locked: boolean }> = {};
      if ('notes' in fields) own.notes = (fields.notes as string) || null;
      if ('labelIds' in fields) own.labelIds = fields.labelIds as string[];
      if ('locked' in fields) own.locked = fields.locked as boolean;
      delete fields.notes;
      delete fields.labelIds;
      delete fields.locked;
      if (Object.keys(own).length > 0) await this.merger.setLocal(who, mapId, solarSystemId, own);
    }
    if (Object.keys(fields).length > 0)
      await this.writeHolders(
        who,
        map,
        'system',
        ref,
        (allowed) => ({
          op: 'system.update',
          key: String(solarSystemId),
          fields: allowed,
        }),
        fields,
      );
    if (request.position) await this.merger.move(who, mapId, [{ solarSystemId, position: request.position }]);
  }

  /** Positions are the merged map's own layout; sources keep theirs. A composite's locks hold. */
  async moveSystems(actor: Actor | null, mapId: string, request: MoveSystemsRequest): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const locked = request.positions.find((p) => map.local.get(p.solarSystemId)?.locked);
    if (locked)
      throw new ConflictError('A locked system cannot be moved', { solarSystemId: locked.solarSystemId });
    await this.merger.move(
      who,
      mapId,
      request.positions.map(({ solarSystemId, x, y }) => ({ solarSystemId, position: { x, y } })),
    );
  }

  /** Hides the system on every writable source holding it; read-only sources keep showing it. */
  async removeSystem(actor: Actor | null, mapId: string, solarSystemId: number): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    if (map.local.get(solarSystemId)?.locked) throw new ConflictError('The system is locked');
    const ref = refId('system', String(solarSystemId));
    await this.writeHolders(who, map, 'system', ref, () => ({
      op: 'system.remove',
      key: String(solarSystemId),
    }));
  }

  /**
   * Connects two systems on the writable sources holding either of them (each adds the other
   * system if it lacks it); with none, on the map's own objects or its first read-write source.
   */
  async addConnection(actor: Actor | null, mapId: string, request: AddConnectionRequest): Promise<void> {
    if (request.source === request.target) throw new ConflictError('A system cannot connect to itself');
    const { who, map } = await this.open(actor, mapId);
    const key = pairKey(request.source, request.target);
    if (map.merge.holders(refId('connection', key)).length > 0) return;
    const holding = new Set([
      ...map.merge.holders(refId('system', String(request.source))),
      ...map.merge.holders(refId('system', String(request.target))),
    ]);
    let targets = this.writable(map, 'connection').filter((s) => holding.has(s.id));
    if (targets.length === 0) targets = this.newObjectTargets(map, 'connection').slice(0, 1);
    if (targets.length === 0) throw new ForbiddenError('No map this one merges takes new connections');
    for (const target of targets)
      await this.write(who, map, target, {
        op: 'connection.add',
        key,
        ...(request.type ? { kind: request.type as ConnectionType } : {}),
      });
  }

  async updateConnection(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    request: UpdateConnectionRequest,
  ): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const group = connectionGroupOf(connectionId);
    if (!group) throw new NotFoundError('Connection');
    const fields = connectionFields(request);
    if (Object.keys(fields).length === 0) return;
    await this.writeHolders(
      who,
      map,
      'connection',
      refId('connection', group.pair),
      (allowed) => ({
        op: 'connection.update',
        key: group.pair,
        fields: allowed,
      }),
      fields,
    );
  }

  /** Removes it from the writable sources; their deletion hides older read-only copies too. */
  async removeConnection(actor: Actor | null, mapId: string, connectionId: string): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const group = connectionGroupOf(connectionId);
    if (!group) throw new NotFoundError('Connection');
    await this.writeHolders(who, map, 'connection', refId('connection', group.pair), () => ({
      op: 'connection.remove',
      key: group.pair,
    }));
  }

  /** Adds a signature on every writable source holding its system (with signatures shared). */
  async addSignature(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: AddSignatureRequest,
  ): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const key = signatureKey(solarSystemId, request.eveId);
    if (map.merge.holders(refId('signature', key)).length > 0)
      throw new ConflictError(`Signature ${request.eveId} already exists`);
    const fields = signatureFields({
      group: request.group,
      type: request.type,
      name: request.name,
      description: request.description,
    });
    const holders = this.systemWriters(map, solarSystemId);
    if (holders.length === 0) throw new ForbiddenError(this.refusal(map, 'signature'));
    for (const target of holders)
      await this.write(who, map, target, {
        op: 'signature.add',
        system: String(solarSystemId),
        code: request.eveId,
        fields,
      });
  }

  /** Applies a scanner paste on every writable source holding the system; answers with the first one's counts. */
  async pasteSignatures(
    actor: Actor | null,
    mapId: string,
    solarSystemId: number,
    request: PasteSignaturesRequest,
  ): Promise<PasteSignaturesResult> {
    const { who, map } = await this.open(actor, mapId);
    const holders = this.systemWriters(map, solarSystemId);
    if (holders.length === 0) throw new ForbiddenError(this.refusal(map, 'signature'));
    let first: PasteSignaturesResult | null = null;
    for (const target of holders) {
      const result = (await this.write(who, map, target, {
        op: 'signatures.paste',
        system: String(solarSystemId),
        text: request.text,
        mode: request.mode,
      })) as PasteSignaturesResult | undefined;
      first ??= result ?? null;
    }
    return first ?? { added: 0, updated: 0, removed: 0, skipped: [] };
  }

  async updateSignature(
    actor: Actor | null,
    mapId: string,
    signatureId: string,
    request: UpdateSignatureRequest,
  ): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const key = signatureKeyOf(signatureId);
    if (!key) throw new NotFoundError('Signature');
    const fields = signatureFields(request);
    if (Object.keys(fields).length === 0) return;
    await this.writeHolders(
      who,
      map,
      'signature',
      refId('signature', key),
      (allowed) => ({
        op: 'signature.update',
        key,
        fields: allowed,
      }),
      fields,
    );
  }

  async removeSignature(actor: Actor | null, mapId: string, signatureId: string): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const key = signatureKeyOf(signatureId);
    if (!key) throw new NotFoundError('Signature');
    await this.writeHolders(who, map, 'signature', refId('signature', key), () => ({
      op: 'signature.remove',
      key,
    }));
  }

  /**
   * Auto-mapping on a composite: the jump becomes a connection on the sources (see
   * `addConnection`), as the character's owner. Callers check the owner may edit the map.
   */
  async recordJump(
    owner: Actor,
    mapId: string,
    jump: { from: number; to: number; type: ConnectionType },
  ): Promise<void> {
    await this.addConnection(owner, mapId, { source: jump.from, target: jump.to, type: jump.type });
  }

  /**
   * "Log a jump" on a merged map: recorded by one source only (passages stay with the map that
   * records them, and must not count twice) — the one that takes new objects, among the writable
   * sources holding the hole and sharing its status.
   */
  async logPassages(
    actor: Actor | null,
    mapId: string,
    connectionId: string,
    request: LogPassagesRequest,
  ): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const group = connectionGroupOf(connectionId);
    if (!group) throw new NotFoundError('Connection');
    const [low, high] = group.pair.split('-');
    const [target] = this.passageWriters(map, group.pair);
    if (!target) throw new ForbiddenError(this.passageRefusal(map, group.pair));
    await this.write(who, map, target, {
      op: 'passages.log',
      key: group.pair,
      passage: {
        shipTypeId: request.shipTypeId,
        // The merged connection runs from the lower system id to the higher.
        from: request.direction === 'targetToSource' ? high! : low!,
        massMode: request.massMode ?? 'cold',
        ...(request.higgs !== undefined ? { higgs: request.higgs } : {}),
        ...(request.entangler !== undefined ? { entangler: request.entangler } : {}),
        ...(request.mass !== undefined ? { mass: request.mass } : {}),
        ...(request.note ? { note: request.note } : {}),
        count: request.count ?? 1,
        ...(request.occurredAt !== undefined ? { at: request.occurredAt } : {}),
      },
    });
  }

  /** "Reset counter" on every writable source holding the hole that shares its status. */
  async resetPassages(actor: Actor | null, mapId: string, connectionId: string): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const group = connectionGroupOf(connectionId);
    if (!group) throw new NotFoundError('Connection');
    const writers = this.passageWriters(map, group.pair);
    if (writers.length === 0) throw new ForbiddenError(this.passageRefusal(map, group.pair));
    for (const target of writers)
      await this.write(who, map, target, { op: 'passages.reset', key: group.pair });
  }

  // --- helpers --------------------------------------------------------------------------------

  /** Writable sources holding the hole that share its status, the one taking new objects first. */
  private passageWriters(map: MergedMapState, pair: string): SourceInfo[] {
    const holding = new Set(map.merge.holders(refId('connection', pair)));
    const writable = this.writable(map, 'connection').filter(
      (s) => holding.has(s.id) && passagesShared(s.scopes),
    );
    const preferred = this.newObjectTargets(map, 'connection').map((s) => s.id);
    const rank = (s: SourceInfo) => {
      const at = preferred.indexOf(s.id);
      return at < 0 ? preferred.length : at;
    };
    return writable.sort((a, b) => rank(a) - rank(b));
  }

  private passageRefusal(map: MergedMapState, pair: string): string {
    return map.merge.holders(refId('connection', pair)).length === 0
      ? 'Connection not found'
      : `Only maps shared read-only or without ${SCOPE_WORDS.connectionStatus} hold this connection`;
  }

  /** A merged map the actor may edit (member+). */
  private async open(actor: Actor | null, mapId: string): Promise<{ who: Actor; map: MergedMapState }> {
    await requireMapRole(this.ports.access, actor, mapId, 'member');
    const map = await this.merger.state(mapId);
    if (!map) throw new ConflictError('This map does not merge other maps');
    return { who: actor!, map };
  }

  /** Sources that take writes for objects of `kind`: the map itself and read-write shares sharing that kind. */
  private writable(map: MergedMapState, kind: ChainObjectKind): SourceInfo[] {
    return map.sources.filter(
      (s) =>
        !s.hidden &&
        map.merge.hasSource(s.id) &&
        (s.id === SELF || s.level === 'read-write') &&
        objectAllowed(kind, s.scopes),
    );
  }

  /**
   * Where new objects go: the map's own objects, except on a composite (it has none): the source
   * its admins picked, else its first read-write source.
   */
  private newObjectTargets(map: MergedMapState, kind: ChainObjectKind): SourceInfo[] {
    if (map.info.kind !== 'composite') return this.writable(map, kind).filter((s) => s.id === SELF);
    const shares = this.writable(map, kind).filter((s) => s.id !== SELF);
    return [...shares.filter((s) => s.defaultWrite), ...shares.filter((s) => !s.defaultWrite)];
  }

  /** Writable sources holding the system that share signatures. */
  private systemWriters(map: MergedMapState, solarSystemId: number): SourceInfo[] {
    const holding = new Set(map.merge.holders(refId('system', String(solarSystemId))));
    return this.writable(map, 'signature').filter((s) => holding.has(s.id));
  }

  /**
   * Writes to every writable source holding the object, each getting only the fields its share
   * lets the map see. Refused when no such source holds it, or when a field reaches none of them.
   */
  private async writeHolders(
    who: Actor,
    map: MergedMapState,
    kind: ChainObjectKind,
    ref: string,
    command: (fields: Record<string, unknown>) => ChainCommand,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    const holding = new Set(map.merge.holders(ref));
    if (holding.size === 0)
      throw new NotFoundError(
        kind === 'system' ? 'System' : kind === 'connection' ? 'Connection' : 'Signature',
      );
    const writers = this.writable(map, kind).filter((s) => holding.has(s.id));
    if (writers.length === 0)
      throw new ForbiddenError('Only maps shared read-only hold this; it cannot be changed here');
    const plan = writers.map((source) => {
      if (!fields) return { source, fields: {} };
      const refused = new Set(refusedFields(kind, fields, source.scopes));
      return {
        source,
        fields: Object.fromEntries(Object.entries(fields).filter(([name]) => !refused.has(name))),
      };
    });
    if (fields) {
      const taken = new Set(plan.flatMap((p) => Object.keys(p.fields)));
      const missing = Object.keys(fields).filter((f) => !taken.has(f));
      if (missing.length > 0) {
        const words = [...new Set(missing.map((f) => SCOPE_WORDS[scopeOfField(kind, f) ?? 'local']))];
        throw new ForbiddenError(`The maps holding this do not share ${words.join(' or ')} with this map`);
      }
    }
    for (const { source, fields: allowed } of plan) {
      if (fields && Object.keys(allowed).length === 0) continue;
      await this.write(who, map, source, command(allowed));
    }
  }

  private async write(
    who: Actor,
    map: MergedMapState,
    source: SourceInfo,
    command: ChainCommand,
  ): Promise<unknown> {
    const adapter = this.ports.sources.source(source.origin);
    if (!adapter) throw new ConflictError(`${source.name} cannot be reached`);
    const via: AuditMapRef = { instance: LOCAL_INSTANCE, mapId: map.mapId, name: map.info.name };
    // The map's own objects are written as themselves; anything else records where it came from.
    return adapter.write(command, {
      actor: who,
      via: source.id === SELF ? null : via,
      scopes: source.scopes,
    });
  }

  private refusal(map: MergedMapState, kind: ChainObjectKind): string {
    const sharing = map.sources.some((s) => s.id !== SELF && objectAllowed(kind, s.scopes));
    return sharing
      ? 'Only maps shared read-only hold this system'
      : `The maps holding this do not share ${SCOPE_WORDS[kind === 'signature' ? 'signatures' : 'topology']} with this map`;
  }
}
