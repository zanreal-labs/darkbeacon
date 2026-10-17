import {
  ConflictError,
  ForbiddenError,
  hasMapRole,
  NotFoundError,
  requireMapRole,
  type Actor,
  type AuditMapRef,
} from '@darkbeacon/core';
import {
  findSystemSpot,
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
import { layoutLinks } from '../domain/layout.js';
import { passagesShared } from '../domain/passages.js';
import { objectAllowed } from '../domain/scopes.js';
import { isLocked, lockOf, SELF, type MergedLock, type SourceInfo } from '../domain/view.js';
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
    // Placed on this map's own layout by the placement rule, next to `near` or around `around`.
    if (!request.position && (request.near !== undefined || request.around !== undefined)) {
      const placed = new Map([...map.layout].filter(([id]) => id !== request.solarSystemId));
      const links = layoutLinks(placed, (id) => map.merge.neighbours(id));
      request = {
        ...request,
        position: findSystemSpot({
          nodes: [...placed].map(([id, position]) => ({ id, position })),
          links,
          parent: request.near ?? null,
          around: request.around ?? null,
        }),
      };
    }
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
    const lock = this.systemLock(map, solarSystemId);
    // Unlocking lifts the map's own lock when it has one, else the sources' (theirs to lift).
    const lifts =
      request.locked === false ? (lock.here ? 'here' : lock.sources.length > 0 ? 'sources' : null) : null;
    // Locking and unlocking here is for this map's managers, as on any map.
    if (request.locked !== undefined && lifts !== 'sources')
      await requireMapRole(this.ports.access, who, mapId, 'manager');
    const lockSources = this.sourcesOf(map, lock);
    if (lifts === 'sources') await this.requireSourceManagers(who, lockSources, 'system', 'unlock');
    const stays: MergedLock =
      lifts === 'here' ? { here: false, sources: lock.sources } : lifts === 'sources' ? NO_LOCK : lock;
    if (request.position) this.refuseLocked(map, solarSystemId, stays, 'moved');
    if (request.visible === false) this.refuseLocked(map, solarSystemId, stays, 'removed');

    // Labels cross by name: the merged map's own names of the ones picked.
    const fields = systemFields(request, (ids) => labelNamesById(ids, map.info.systemLabels ?? []));
    // A lock counts where it is held: never written to every source like the other fields.
    delete fields.locked;
    if (lifts === 'sources') {
      // Unlocked at the source, as its manager, recorded there as made via this map.
      for (const source of lockSources)
        await this.write(who, map, source, {
          op: 'system.update',
          key: String(solarSystemId),
          fields: { locked: false },
        });
    }
    const own: Partial<{ notes: string | null; labelIds: string[]; locked: boolean }> = {};
    const lockHere = request.locked === true ? !lock.here : lifts === 'here';
    if (lockHere) {
      // A composite keeps its own lock; another map locks its own objects.
      if (composite) own.locked = request.locked!;
      else {
        if (!map.merge.holders(ref).includes(SELF))
          throw new ForbiddenError('Only this map’s own systems can be locked here');
        await this.write(who, map, this.self(map), {
          op: 'system.update',
          key: String(solarSystemId),
          fields: { locked: request.locked },
        });
      }
    }
    if (request.visible === false) {
      if (Object.keys(own).length > 0) await this.merger.setLocal(who, mapId, solarSystemId, own);
      await this.hideSystem(who, map, solarSystemId);
      return;
    }
    if (composite) {
      // Notes, Tags and locks of a composite are its own, kept over what its sources say.
      if ('notes' in fields) own.notes = (fields.notes as string) || null;
      if ('labelIds' in fields) own.labelIds = fields.labelIds as string[];
      delete fields.notes;
      delete fields.labelIds;
    }
    if (Object.keys(own).length > 0) await this.merger.setLocal(who, mapId, solarSystemId, own);
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

  /**
   * Positions are the merged map's own layout; sources keep theirs. Locks hold, the map's own and
   * its sources' alike.
   */
  async moveSystems(actor: Actor | null, mapId: string, request: MoveSystemsRequest): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    for (const { solarSystemId } of request.positions)
      this.refuseLocked(map, solarSystemId, this.systemLock(map, solarSystemId), 'moved');
    await this.merger.move(
      who,
      mapId,
      request.positions.map(({ solarSystemId, x, y }) => ({ solarSystemId, position: { x, y } })),
    );
  }

  /**
   * Hides the system on every writable source holding it; read-only sources keep showing it.
   * Refused while it is locked here or on any map it comes from.
   */
  async removeSystem(actor: Actor | null, mapId: string, solarSystemId: number): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    this.refuseLocked(map, solarSystemId, this.systemLock(map, solarSystemId), 'removed');
    await this.hideSystem(who, map, solarSystemId);
  }

  private async hideSystem(who: Actor, map: MergedMapState, solarSystemId: number): Promise<void> {
    const ref = refId('system', String(solarSystemId));
    // A source hides a system a locked connection of its own leads to for its managers only.
    const holding = new Set(map.merge.holders(ref));
    const heldByLocked = this.writable(map, 'system').filter(
      (source) =>
        source.id !== SELF &&
        holding.has(source.id) &&
        map.merge
          .held(source.id, 'connection', solarSystemId)
          .some((c) => map.merge.sourceField(source.id, c, 'locked') === true),
    );
    await this.requireSourceManagers(who, heldByLocked, 'connection', 'remove-system');
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
    const ref = refId('connection', group.pair);
    const fields = connectionFields(request);
    // A lock counts where it is held: never written to every source like the other fields.
    const locked = fields.locked as boolean | undefined;
    delete fields.locked;
    if (locked === undefined && Object.keys(fields).length === 0) return;
    const holders = map.merge.holders(ref);
    if (holders.length === 0) throw new NotFoundError('Connection');
    const lock = lockOf(map.merge, ref, holders);
    const setLock = (source: SourceInfo, value: boolean) =>
      this.write(who, map, source, { op: 'connection.update', key: group.pair, fields: { locked: value } });

    // Unlocking lifts the map's own lock when it has one, else the sources' (theirs to lift).
    const liftsSources = locked === false && !lock.here && lock.sources.length > 0;
    if (locked === false && isLocked(lock)) {
      const targets = lock.here ? [this.self(map)] : this.sourcesOf(map, lock);
      await this.requireSourceManagers(who, targets, 'connection', 'unlock');
      for (const target of targets) await setLock(target, false);
    }
    if (Object.keys(fields).length > 0) {
      // Changing a connection a source locks is for that map's managers.
      if (!liftsSources)
        await this.requireSourceManagers(who, this.lockedWriters(map, lock), 'connection', 'change');
      await this.writeHolders(
        who,
        map,
        'connection',
        ref,
        (allowed) => ({ op: 'connection.update', key: group.pair, fields: allowed }),
        fields,
      );
    }
    // Locking: the map's own connection, else the writable sources holding it (their managers).
    if (locked === true && !isLocked(lock)) {
      const targets = holders.includes(SELF)
        ? [this.self(map)]
        : this.writable(map, 'connection').filter((s) => holders.includes(s.id));
      if (targets.length === 0)
        throw new ForbiddenError('Only maps shared read-only hold this; it cannot be changed here');
      await this.requireSourceManagers(who, targets, 'connection', 'lock');
      for (const target of targets) await setLock(target, true);
    }
  }

  /** Removes it from the writable sources; their deletion hides older read-only copies too. */
  async removeConnection(actor: Actor | null, mapId: string, connectionId: string): Promise<void> {
    const { who, map } = await this.open(actor, mapId);
    const group = connectionGroupOf(connectionId);
    if (!group) throw new NotFoundError('Connection');
    const ref = refId('connection', group.pair);
    // Removing a connection a source locks is for that map's managers.
    const lock = lockOf(map.merge, ref, map.merge.holders(ref));
    await this.requireSourceManagers(who, this.lockedWriters(map, lock), 'connection', 'remove');
    await this.writeHolders(who, map, 'connection', ref, () => ({
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
      tempName: request.tempName,
      destination: request.destination,
      bubbled: request.bubbled,
      timeStatus: request.timeStatus,
      massStatus: request.massStatus,
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

  /** Who locks a merged system: the map itself (a composite's own lock) and merged sources. */
  private systemLock(map: MergedMapState, solarSystemId: number): MergedLock {
    const ref = refId('system', String(solarSystemId));
    return lockOf(map.merge, ref, map.merge.holders(ref), map.local.get(solarSystemId));
  }

  private sourcesOf(map: MergedMapState, lock: MergedLock): SourceInfo[] {
    return lock.sources.flatMap((id) => map.sources.find((s) => s.id === id) ?? []);
  }

  /** The sources locking an object that a write to it reaches (read-only ones are not written). */
  private lockedWriters(map: MergedMapState, lock: MergedLock): SourceInfo[] {
    const writing = new Set(this.writable(map, 'connection').map((s) => s.id));
    return this.sourcesOf(map, lock).filter((s) => writing.has(s.id));
  }

  private self(map: MergedMapState): SourceInfo {
    return map.sources.find((s) => s.id === SELF)!;
  }

  /** A locked system cannot be moved or removed: refused naming the map that holds the lock. */
  private refuseLocked(
    map: MergedMapState,
    solarSystemId: number,
    lock: MergedLock,
    what: 'moved' | 'removed',
  ): void {
    if (lock.here)
      throw new ConflictError(what === 'moved' ? 'A locked system cannot be moved' : 'The system is locked', {
        solarSystemId,
      });
    const on = this.sourcesOf(map, lock).map((s) => s.name);
    if (on.length === 0) return;
    const names = listNames(on);
    throw new ConflictError(
      `The system is locked on ${names}, so it cannot be ${what} here; a manager of ${names} can unlock it`,
      { solarSystemId, lockedOn: on },
    );
  }

  /**
   * A source's locks are its managers' to lift (and a connection it locks theirs to change or
   * remove): the person must manage every one of `sources` (the map's own objects check that
   * themselves). Refused before anything changes, naming the maps.
   */
  private async requireSourceManagers(
    who: Actor,
    sources: readonly SourceInfo[],
    kind: 'system' | 'connection',
    what: 'unlock' | 'lock' | 'change' | 'remove' | 'remove-system',
  ): Promise<void> {
    const refused: string[] = [];
    for (const source of sources) {
      if (source.id === SELF) continue;
      const role =
        source.origin.instance === LOCAL_INSTANCE
          ? await this.ports.access.roleOf(who, source.origin.mapId)
          : null;
      if (!hasMapRole(role, 'manager')) refused.push(source.name);
    }
    if (refused.length === 0) return;
    const names = listNames(refused);
    const message = {
      unlock: `The ${kind} is locked on ${names}; only a manager of ${names} can unlock it`,
      lock: `Only a manager of ${names} can lock this ${kind}`,
      change: `The ${kind} is locked on ${names}; only a manager of ${names} can change it`,
      remove: `The ${kind} is locked on ${names}; only a manager of ${names} can remove it`,
      'remove-system': `A connection locked on ${names} leads to the system; only a manager of ${names} can remove it`,
    }[what];
    throw new ForbiddenError(message, { lockedOn: refused });
  }

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

const NO_LOCK: MergedLock = { here: false, sources: [] };

/** "Corp A", "Corp A and Corp B", "Corp A, Corp B and Corp C". */
function listNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
