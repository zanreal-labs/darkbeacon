import {
  ForbiddenError,
  hasMapRole,
  NotFoundError,
  type Actor,
  type AuditScope,
  type GrantingMapRole,
  type MapAccess,
  type MapRole,
} from '@darkbeacon/core';
import {
  ConnectionUseCases,
  PassageUseCases,
  signatureTypeCode,
  SignatureUseCases,
  SystemUseCases,
  type Connection,
  type FieldTimes,
  type MappingPorts,
  type MapSystem,
  type Signature,
} from '@darkbeacon/mapping';
import {
  LOCAL_INSTANCE,
  type Bubbled,
  type ChainDelta,
  type ChainEntry,
  type ChainOrigin,
  type CharacterPresenceDto,
  type ShareScope,
  type StampedValue,
  type UpdateConnectionRequest,
  type UpdateSignatureRequest,
  type UpdateSystemRequest,
} from '@darkbeacon/shared';
import { LifetimeMark } from '@darkbeacon/shared';
import {
  labelIdsByName,
  labelNamesById,
  pairKey,
  parsePair,
  passageKey,
  passagesShared,
  pilotsShared,
  parseSignatureKey,
  projectEntry,
  refusedFields,
  SCOPE_WORDS,
  scopeOfField,
  signatureKey,
  type ChainCommand,
  type ChainMapInfo,
  type ChainPassage,
  type ChainSelector,
  type ChainSource,
  type ChainSources,
  type ChainWriteContext,
} from '@darkbeacon/sharing';
import { arrivalSpot } from '../tracking/mapping-auto-map-target.js';

/** The tracked characters of a map (tracking's ListMapCharacters). */
export interface MapCharacters {
  forMap(mapId: string): Promise<CharacterPresenceDto[]>;
}

export interface LocalChainDeps {
  ports: MappingPorts;
  characters: MapCharacters;
  audit: AuditScope;
}

/** Sharing's ChainSources for maps of this instance; other instances are not reachable yet. */
export class LocalChainSources implements ChainSources {
  constructor(private readonly deps: LocalChainDeps) {}

  source(origin: ChainOrigin): ChainSource | null {
    return origin.instance === LOCAL_INSTANCE ? new LocalChainSource(origin.mapId, this.deps) : null;
  }

  async describe(origin: ChainOrigin): Promise<ChainMapInfo | null> {
    if (origin.instance !== LOCAL_INSTANCE) return null;
    const map = await this.deps.ports.maps.findById(origin.mapId);
    return map
      ? {
          origin,
          name: map.name,
          slug: map.slug,
          kind: map.kind ?? 'standard',
          instanceName: null,
          systemLabels: map.systemLabels,
        }
      : null;
  }

  async findLocalBySlug(slug: string): Promise<ChainMapInfo | null> {
    const map = await this.deps.ports.maps.findBySlug(slug);
    return map ? this.describe({ instance: LOCAL_INSTANCE, mapId: map.id }) : null;
  }
}

const stamp = (v: unknown, at: number): StampedValue => ({ v, at });

/**
 * One map of this instance as a ChainSource: reads mapping's rows (with their field times and
 * tombstones) into the wire format, cut to the share's scopes before they leave, and applies
 * changes made through a merged map with mapping's own use cases.
 */
export class LocalChainSource implements ChainSource {
  readonly origin: ChainOrigin;

  constructor(
    private readonly mapId: string,
    private readonly deps: LocalChainDeps,
  ) {
    this.origin = { instance: LOCAL_INSTANCE, mapId };
  }

  // --- reading --------------------------------------------------------------------------------

  async read(
    scopes: readonly ShareScope[] | 'all',
    selectors?: readonly ChainSelector[],
  ): Promise<ChainDelta> {
    const { ports } = this.deps;
    const mapId = this.mapId;
    const want = plan(selectors);
    const entries: ChainEntry[] = [];

    // A deleted map (restorable) shows nothing to the maps that merge it until it is back.
    const trashed = !!(await ports.maps.findById(mapId))?.deletedAt;
    const systems = trashed ? [] : await ports.systems.list(mapId);
    const visible = new Map(systems.filter((s) => s.visible).map((s) => [s.solarSystemId, s]));

    if (want.system) {
      const times = await ports.stamps.fieldTimes(mapId, 'system');
      const systemLabels = (await ports.maps.findById(mapId))?.systemLabels ?? [];
      for (const system of systems) {
        const key = String(system.solarSystemId);
        if (!want.system.has(key) && !want.system.all) continue;
        // A hidden system is the map's intel library: kept, not shown (see `hiddenCopy`).
        const entry = systemEntry(system, times.get(key) ?? {}, systemLabels);
        entries.push(system.visible ? entry : { ...entry, hidden: true });
      }
    }

    const needConnections = (want.connection || want.signature) && !trashed;
    const connections = needConnections ? await ports.connections.list(mapId) : [];
    const signatures = needConnections ? await ports.signatures.listForMap(mapId) : [];
    if (want.connection) {
      const times = await ports.stamps.fieldTimes(mapId, 'connection');
      const tombstones = await ports.stamps.tombstones(mapId, 'connection');
      const live = new Set<string>();
      for (const connection of connections) {
        const key = pairKey(connection.source, connection.target);
        if (!want.connection.matches(key)) continue;
        live.add(key);
        const linked = signatures.filter((s) => s.connectionId === connection.id);
        entries.push(connectionEntry(connection, times.get(connection.id) ?? {}, linked));
      }
      for (const [key, at] of tombstones) {
        if (!live.has(key) && want.connection.matches(key))
          entries.push({ kind: 'connection', key, state: 'deleted', at });
      }
    }
    if (want.signature) {
      const times = await ports.stamps.fieldTimes(mapId, 'signature');
      const tombstones = await ports.stamps.tombstones(mapId, 'signature');
      const pairs = new Map(connections.map((c) => [c.id, pairKey(c.source, c.target)]));
      const live = new Set<string>();
      for (const signature of signatures) {
        const key = signatureKey(signature.solarSystemId, signature.eveId);
        if (!want.signature.matches(key)) continue;
        live.add(key);
        // A hidden system's signatures are kept with it: intel where another map shows the system.
        const entry = signatureEntry(signature, times.get(signature.id) ?? {}, pairs);
        entries.push(visible.has(signature.solarSystemId) ? entry : { ...entry, hidden: true });
      }
      for (const [key, at] of tombstones) {
        if (!live.has(key) && want.signature.matches(key))
          entries.push({ kind: 'signature', key, state: 'deleted', at });
      }
    }
    if (want.character && !trashed) {
      for (const character of await this.deps.characters.forMap(mapId)) {
        const key = String(character.characterId);
        if (!want.character.all && !want.character.has(key)) continue;
        entries.push(characterEntry(character));
      }
    }

    const cut: ChainEntry[] = [];
    for (const entry of entries) {
      const projected = hiddenCopy(projectEntry(entry, scopes));
      if (projected) cut.push(projected);
    }
    return {
      v: 1,
      origin: this.origin,
      scopes:
        scopes === 'all'
          ? ['topology', 'connectionStatus', 'signatures', 'intel', 'characters', 'labels']
          : [...scopes],
      full: selectors === undefined,
      entries: cut,
      at: ports.clock.now(),
    };
  }

  // --- writing --------------------------------------------------------------------------------

  async passages(key: string, scopes: readonly ShareScope[] | 'all'): Promise<ChainPassage[]> {
    if (!passagesShared(scopes)) return [];
    const { ports } = this.deps;
    const connection = await this.connectionOrNull(key);
    if (!connection) return [];
    const rows = await ports.passages.listForConnection(this.mapId, connection.id);
    const withPilots = pilotsShared(scopes);
    const pilots = withPilots
      ? [...new Set(rows.flatMap((p) => (p.characterId === null ? [] : [p.characterId])))]
      : [];
    const names = pilots.length > 0 && ports.pilots ? await ports.pilots.names(pilots) : new Map();
    return rows.map((p) => ({
      key: passageKey({ ...p, at: p.occurredAt }),
      // Only the map's own merged view keeps row ids (its passages stay editable there).
      ...(scopes === 'all' ? { id: p.id } : {}),
      at: p.occurredAt,
      from: p.from,
      to: p.to,
      shipTypeId: p.shipTypeId,
      mass: p.mass,
      source: p.source,
      massMode: p.massMode,
      higgs: p.higgs,
      entangler: p.entangler,
      note: p.note,
      pilot:
        withPilots && p.characterId !== null
          ? { id: p.characterId, name: names.get(p.characterId) ?? null }
          : null,
    }));
  }

  async write(command: ChainCommand, context: ChainWriteContext): Promise<unknown> {
    if (command.op.startsWith('passages.') && !passagesShared(context.scopes))
      throw new ForbiddenError(`This map does not share ${SCOPE_WORDS.connectionStatus}`);
    if ('fields' in command) {
      const kind = command.op.startsWith('system')
        ? 'system'
        : command.op.startsWith('connection')
          ? 'connection'
          : 'signature';
      const refused = refusedFields(kind, command.fields, context.scopes);
      if (refused.length > 0) {
        const words = [...new Set(refused.map((f) => SCOPE_WORDS[scopeOfField(kind, f) ?? 'local']))];
        throw new ForbiddenError(`This map does not share ${words.join(' or ')}`);
      }
    }
    const run = () => this.apply(command, context.actor, context.via !== null);
    return context.via ? this.deps.audit.run({ via: context.via }, run) : run();
  }

  /** Mapping's use cases, acting as `actor`; a write through a share counts as a member of this map. */
  private useCases(delegated: boolean) {
    const ports: MappingPorts = delegated
      ? { ...this.deps.ports, access: new DelegatedAccess(this.deps.ports.access, this.mapId) }
      : this.deps.ports;
    return {
      systems: new SystemUseCases(ports),
      connections: new ConnectionUseCases(ports),
      signatures: new SignatureUseCases(ports),
      passages: new PassageUseCases(ports),
    };
  }

  private async apply(command: ChainCommand, actor: Actor, delegated: boolean): Promise<unknown> {
    const { systems, connections, signatures, passages } = this.useCases(delegated);
    const { ports } = this.deps;
    const mapId = this.mapId;
    switch (command.op) {
      case 'system.add': {
        const solarSystemId = Number(command.key);
        // A share's position belongs to the merged map; the map's own objects keep it.
        await systems.add(
          actor,
          mapId,
          delegated || !command.hint ? { solarSystemId } : { solarSystemId, position: command.hint },
        );
        return;
      }
      case 'system.update': {
        const systemLabels = (await ports.maps.findById(mapId))?.systemLabels ?? [];
        await systems.update(actor, mapId, Number(command.key), systemRequest(command.fields, systemLabels));
        return;
      }
      case 'system.remove':
        await systems.remove(actor, mapId, Number(command.key));
        return;
      case 'connection.add': {
        const pair = parsePair(command.key);
        if (!pair) throw new NotFoundError('Connection');
        await this.place(actor, delegated, pair[0], pair[1]);
        await this.place(actor, delegated, pair[1], pair[0]);
        await connections.add(actor, mapId, {
          source: pair[0],
          target: pair[1],
          ...(command.kind ? { type: command.kind } : {}),
        });
        return;
      }
      case 'connection.update': {
        const connection = await this.connection(command.key);
        await connections.update(actor, mapId, connection.id, connectionRequest(command.fields, connection));
        return;
      }
      case 'connection.remove':
        await connections.remove(actor, mapId, (await this.connection(command.key)).id);
        return;
      case 'signature.add': {
        const solarSystemId = Number(command.system);
        const f = command.fields;
        const added = await signatures.add(actor, mapId, solarSystemId, {
          eveId: command.code,
          ...(typeof f.group === 'string' ? { group: f.group as Signature['group'] } : {}),
          ...(f.type !== undefined ? { type: f.type as string | null } : {}),
          ...(f.name !== undefined ? { name: f.name as string | null } : {}),
          ...(typeof f.notes === 'string' ? { description: f.notes } : {}),
          ...signatureExtras(f),
        });
        if (typeof f.link === 'string') {
          const linked = await this.connectionOrNull(f.link);
          if (linked) await signatures.update(actor, mapId, added.id, { connectionId: linked.id });
        }
        return;
      }
      case 'signature.update': {
        const signature = await this.signature(command.key);
        const request = await this.signatureRequest(command.fields);
        await signatures.update(actor, mapId, signature.id, request);
        return;
      }
      case 'signature.remove':
        await signatures.remove(actor, mapId, (await this.signature(command.key)).id);
        return;
      case 'signatures.paste':
        return signatures.paste(actor, mapId, Number(command.system), {
          text: command.text,
          mode: command.mode,
        });
      case 'passages.log': {
        const connection = await this.connection(command.key);
        const p = command.passage;
        await passages.log(actor, mapId, connection.id, {
          shipTypeId: p.shipTypeId,
          direction: Number(p.from) === connection.source ? 'sourceToTarget' : 'targetToSource',
          massMode: p.massMode,
          ...(p.higgs !== undefined ? { higgs: p.higgs } : {}),
          ...(p.entangler !== undefined ? { entangler: p.entangler } : {}),
          ...(p.mass !== undefined ? { mass: p.mass } : {}),
          ...(p.note ? { note: p.note } : {}),
          count: p.count,
          ...(p.at !== undefined ? { occurredAt: p.at } : {}),
        });
        return;
      }
      case 'passages.reset':
        await passages.resetCounter(actor, mapId, (await this.connection(command.key)).id);
        return;
    }
    void ports;
  }

  /** Adds `solarSystemId` next to `near` unless this map shows it already (as auto-mapping does). */
  private async place(actor: Actor, delegated: boolean, solarSystemId: number, near: number): Promise<void> {
    const { systems } = this.useCases(delegated);
    const spot = arrivalSpot(await this.deps.ports.systems.list(this.mapId), solarSystemId, near);
    if (spot) await systems.add(actor, this.mapId, { solarSystemId, ...spot });
  }

  private async connectionOrNull(key: string): Promise<Connection | null> {
    const pair = parsePair(key);
    return pair ? this.deps.ports.connections.findBetween(this.mapId, pair[0], pair[1]) : null;
  }

  private async connection(key: string): Promise<Connection> {
    const connection = await this.connectionOrNull(key);
    if (!connection) throw new NotFoundError('Connection');
    return connection;
  }

  private async signature(key: string): Promise<Signature> {
    const parsed = parseSignatureKey(key);
    if (!parsed) throw new NotFoundError('Signature');
    const found = (await this.deps.ports.signatures.listForSystem(this.mapId, parsed.solarSystemId)).find(
      (s) => s.eveId === parsed.eveId,
    );
    if (!found) throw new NotFoundError('Signature');
    return found;
  }

  private async signatureRequest(fields: Record<string, unknown>): Promise<UpdateSignatureRequest> {
    const request: UpdateSignatureRequest = {};
    if (typeof fields.code === 'string') request.eveId = fields.code;
    if (typeof fields.group === 'string') request.group = fields.group as Signature['group'];
    if (fields.type !== undefined) request.type = fields.type as string | null;
    if (fields.name !== undefined) request.name = fields.name as string | null;
    if (typeof fields.notes === 'string') request.description = fields.notes;
    Object.assign(request, signatureExtras(fields));
    if (fields.kind === 'signature' || fields.kind === 'anomaly' || fields.kind === 'other')
      request.kind = fields.kind;
    if (fields.link === null) request.connectionId = null;
    else if (typeof fields.link === 'string') {
      // This map may not have that connection; then the link stays as it is here.
      const connection = await this.connectionOrNull(fields.link);
      if (connection) request.connectionId = connection.id;
    }
    return request;
  }
}

/**
 * MapAccess for writes made through a read-write share: the merged map already checked that the
 * actor edits it, so here they count as a member. A block on this map still wins.
 */
class DelegatedAccess implements MapAccess {
  constructor(
    private readonly base: MapAccess,
    private readonly mapId: string,
  ) {}

  async roleOf(actor: Actor, mapId: string): Promise<MapRole | null> {
    const role = await this.base.roleOf(actor, mapId);
    if (mapId !== this.mapId || role === 'blocked' || hasMapRole(role, 'member')) return role;
    return 'member';
  }

  mapsFor(actor: Actor): Promise<Array<{ mapId: string; role: GrantingMapRole }>> {
    return this.base.mapsFor(actor);
  }
}

// --- reading helpers ----------------------------------------------------------------------------

/** Fields a hidden copy has no use for: where and whether it is locked count only where it shows. */
const HIDDEN_SKIPS: Partial<Record<ChainEntry['kind'], ReadonlySet<string>>> = {
  system: new Set(['pos', 'locked']),
};

/**
 * A hidden copy (cut to the scopes already) keeps only what it can lend a map that shows the
 * object elsewhere: fields someone wrote. With nothing left, the source simply does not hold it,
 * so a share without intel or labels sends nothing of the map's hidden systems.
 */
function hiddenCopy(entry: ChainEntry | null): ChainEntry | null {
  if (!entry || entry.state !== 'present' || !entry.hidden) return entry;
  const skip = HIDDEN_SKIPS[entry.kind];
  const fields: typeof entry.fields = {};
  for (const [name, value] of Object.entries(entry.fields)) {
    if (value.at > 0 && !skip?.has(name)) fields[name] = value;
  }
  if (Object.keys(fields).length === 0) return { kind: entry.kind, key: entry.key, state: 'absent' };
  return { ...entry, fields };
}

interface KindPlan {
  all: boolean;
  keys: Set<string>;
  systems: Set<number>;
  has(key: string): boolean;
  matches(key: string): boolean;
}

/** Which keys of each kind to read; `undefined` selectors read everything. */
function plan(
  selectors: readonly ChainSelector[] | undefined,
): Partial<Record<ChainEntry['kind'], KindPlan>> {
  const out: Partial<Record<ChainEntry['kind'], KindPlan>> = {};
  const get = (kind: ChainEntry['kind']) => {
    let p = out[kind];
    if (!p) {
      const created: KindPlan = {
        all: false,
        keys: new Set(),
        systems: new Set(),
        has: (key) => created.keys.has(key),
        matches: (key) => {
          if (created.all || created.keys.has(key)) return true;
          const systems =
            kind === 'connection'
              ? (parsePair(key) ?? [])
              : kind === 'signature'
                ? [parseSignatureKey(key)?.solarSystemId ?? -1]
                : [Number(key)];
          return systems.some((s) => created.systems.has(s));
        },
      };
      out[kind] = p = created;
    }
    return p;
  };
  if (!selectors) {
    for (const kind of ['system', 'connection', 'signature', 'character'] as const) get(kind).all = true;
    return out;
  }
  for (const s of selectors) {
    const p = get(s.kind);
    if ('key' in s) p.keys.add(s.key);
    else if (s.solarSystemId !== undefined) p.systems.add(s.solarSystemId);
    else p.all = true;
  }
  return out;
}

/**
 * When a field last changed: its recorded time, else when the object was made. A field nobody set
 * since then that still holds the default every new object starts with was never written at all
 * (time 0): a map that only added a system, a hole or a signature must not blank the status, notes,
 * mass or name another map set on it earlier. A value the object was made with still counts then.
 */
const at = (times: FieldTimes, field: string, born: number, unset = false) =>
  times[field] ?? (unset ? 0 : born);
const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0);

/** The map's Labels, to name the ones a system has (they cross by name). */
type LabelList = ReadonlyArray<{ id: string; name: string }>;

type PresentEntry = Extract<ChainEntry, { state: 'present' }>;

function systemEntry(s: MapSystem, times: FieldTimes, systemLabels: LabelList): PresentEntry {
  const born = s.createdAt;
  return {
    kind: 'system',
    key: String(s.solarSystemId),
    state: 'present',
    born,
    fields: {
      pos: stamp(s.position, at(times, 'position', born)),
      status: stamp(s.status, at(times, 'status', born, s.status === 'unknown')),
      tag: stamp(s.tag, at(times, 'tag', born, isEmpty(s.tag))),
      customName: stamp(s.customName, at(times, 'customName', born, isEmpty(s.customName))),
      notes: stamp(s.description, at(times, 'description', born, isEmpty(s.description))),
      label: stamp(s.temporaryName, at(times, 'temporaryName', born, isEmpty(s.temporaryName))),
      systemLabels: stamp(
        labelNamesById(s.systemLabelIds, systemLabels),
        at(times, 'systemLabelIds', born, isEmpty(s.systemLabelIds)),
      ),
      customLabel: stamp(s.customLabel, at(times, 'customLabel', born, isEmpty(s.customLabel))),
      labelIds: stamp(s.labelIds, at(times, 'labelIds', born, isEmpty(s.labelIds))),
      locked: stamp(s.locked, at(times, 'locked', born, !s.locked)),
    },
  };
}

/** Bubbles by system id: `low` is the end with the lower id. */
function bubbledByEnd(c: Connection): string {
  if (c.bubbled === 'none' || c.bubbled === 'both') return c.bubbled;
  const end = c.bubbled === 'source' ? c.source : c.target;
  return end === Math.min(c.source, c.target) ? 'low' : 'high';
}

function connectionEntry(c: Connection, times: FieldTimes, linked: readonly Signature[]): ChainEntry {
  const born = c.createdAt;
  const freshTime = c.timeStatus === 'normal' && c.eolAt === null;
  const freshMass = c.massStatus === 'fresh' && (c.massStatusAt ?? null) === null;
  const typed = linked
    .map((s) => ({ code: signatureTypeCode(s), at: s.updatedAt }))
    .filter((t): t is { code: string; at: number } => !!t.code && t.code !== 'K162');
  const fields: Record<string, StampedValue> = {
    kind: stamp(c.type, at(times, 'type', born)),
    time: stamp(
      { status: c.timeStatus, eolAt: c.eolAt },
      Math.max(at(times, 'timeStatus', born, freshTime), at(times, 'eolAt', born, freshTime)),
    ),
    mass: stamp(
      { status: c.massStatus, at: c.massStatusAt ?? null },
      Math.max(at(times, 'massStatus', born, freshMass), at(times, 'massStatusAt', born, freshMass)),
    ),
    // Made from the systems' classes, the same everywhere: it counts from when the hole was made.
    size: stamp(c.shipSize, at(times, 'shipSize', born)),
    massSaved: stamp(c.massSaved, at(times, 'massSaved', born, !c.massSaved)),
    dangerous: stamp(c.dangerous, at(times, 'dangerous', born, !c.dangerous)),
    bubbled: stamp(bubbledByEnd(c), at(times, 'bubbled', born, c.bubbled === 'none')),
    lifetime: stamp(c.lifetime ?? null, at(times, 'lifetime', born, isEmpty(c.lifetime))),
    note: stamp(c.note ?? '', at(times, 'note', born, isEmpty(c.note))),
    locked: stamp(c.locked ?? false, at(times, 'locked', born, !c.locked)),
  };
  if (typed.length > 0) {
    const first = typed.sort((a, b) => a.at - b.at)[0]!;
    fields.whType = stamp(first.code, first.at);
  }
  return { kind: 'connection', key: pairKey(c.source, c.target), state: 'present', born, fields };
}

function signatureEntry(s: Signature, times: FieldTimes, pairs: ReadonlyMap<string, string>): PresentEntry {
  const born = s.createdAt;
  return {
    kind: 'signature',
    key: signatureKey(s.solarSystemId, s.eveId),
    state: 'present',
    born,
    fields: {
      group: stamp(s.group, at(times, 'group', born, s.group === 'unknown')),
      type: stamp(s.type, at(times, 'type', born, isEmpty(s.type))),
      name: stamp(s.name, at(times, 'name', born, isEmpty(s.name))),
      notes: stamp(s.description, at(times, 'description', born, isEmpty(s.description))),
      link: stamp(
        s.connectionId ? (pairs.get(s.connectionId) ?? null) : null,
        at(times, 'connectionId', born, isEmpty(s.connectionId)),
      ),
      tempName: stamp(s.tempName ?? null, at(times, 'tempName', born, isEmpty(s.tempName))),
      destination: stamp(s.destination ?? null, at(times, 'destination', born, isEmpty(s.destination))),
      bubbled: stamp(s.bubbled ?? false, at(times, 'bubbled', born, !s.bubbled)),
      time: stamp(s.timeStatus ?? null, at(times, 'timeStatus', born, isEmpty(s.timeStatus))),
      mass: stamp(s.massStatus ?? null, at(times, 'massStatus', born, isEmpty(s.massStatus))),
      kind: stamp(s.kind ?? 'signature', at(times, 'kind', born)),
      custom: stamp(s.custom ?? false, at(times, 'custom', born, !s.custom)),
    },
  };
}

function characterEntry(c: CharacterPresenceDto): ChainEntry {
  const t = c.updatedAt;
  return {
    kind: 'character',
    key: String(c.characterId),
    state: 'present',
    born: t,
    fields: {
      name: stamp(c.name, t),
      location: stamp(c.solarSystemId, t),
      ship: stamp({ typeId: c.shipTypeId, name: c.shipName }, t),
      online: stamp(c.online, t),
      account: stamp(c.accountId, t),
    },
  };
}

// --- writing helpers ----------------------------------------------------------------------------

/** Temporary name, destination, bubble, lifetime and mass of a signature, from wire fields. */
function signatureExtras(f: Record<string, unknown>): UpdateSignatureRequest {
  const r: UpdateSignatureRequest = {};
  if (f.tempName !== undefined) r.tempName = f.tempName as string | null;
  if (f.destination !== undefined) r.destination = f.destination as Signature['destination'];
  if (typeof f.bubbled === 'boolean') r.bubbled = f.bubbled;
  if (f.time !== undefined) r.timeStatus = f.time as Signature['timeStatus'];
  if (f.mass !== undefined) r.massStatus = f.mass as Signature['massStatus'];
  return r;
}

function systemRequest(f: Record<string, unknown>, systemLabels: LabelList): UpdateSystemRequest {
  const r: UpdateSystemRequest = {};
  if (typeof f.status === 'string') r.status = f.status as MapSystem['status'];
  if (f.tag !== undefined) r.tag = f.tag as string | null;
  if (f.customName !== undefined) r.customName = f.customName as string | null;
  if (typeof f.notes === 'string') r.description = f.notes;
  if (f.label !== undefined) r.temporaryName = f.label as string | null;
  // Names this map has no Label of drop out.
  if (Array.isArray(f.systemLabels)) r.systemLabelIds = labelIdsByName(f.systemLabels, systemLabels);
  if (f.customLabel !== undefined) r.customLabel = f.customLabel as string | null;
  if (Array.isArray(f.labelIds)) r.labelIds = f.labelIds as string[];
  if (typeof f.locked === 'boolean') r.locked = f.locked;
  return r;
}

function connectionRequest(f: Record<string, unknown>, current: Connection): UpdateConnectionRequest {
  const r: UpdateConnectionRequest = {};
  if (typeof f.kind === 'string') r.type = f.kind as Connection['type'];
  const time = f.time as { status?: Connection['timeStatus'] } | undefined;
  if (time?.status) r.timeStatus = time.status;
  const mass = f.mass as { status?: Connection['massStatus'] } | undefined;
  if (mass?.status) r.massStatus = mass.status;
  if (typeof f.size === 'string') r.shipSize = f.size as Connection['shipSize'];
  if (typeof f.massSaved === 'boolean') r.massSaved = f.massSaved;
  if (typeof f.dangerous === 'boolean') r.dangerous = f.dangerous;
  if (typeof f.bubbled === 'string') r.bubbled = bubbledToDirection(f.bubbled, current);
  if (typeof f.note === 'string') r.note = f.note;
  if (typeof f.locked === 'boolean') r.locked = f.locked;
  if (f.lifetime === null) r.lifetime = null;
  else if (f.lifetime && typeof f.lifetime === 'object') {
    const mark = (f.lifetime as { mark?: unknown }).mark;
    if (typeof mark === 'string' && (LifetimeMark.options as readonly string[]).includes(mark))
      r.lifetime = mark as LifetimeMark;
  }
  return r;
}

/** Wire `low|high` back to this map's own direction of the connection. */
function bubbledToDirection(value: string, c: Connection): Bubbled {
  if (value === 'none' || value === 'both') return value;
  const end = value === 'low' ? Math.min(c.source, c.target) : Math.max(c.source, c.target);
  return end === c.source ? 'source' : 'target';
}
