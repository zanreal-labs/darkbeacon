import type {
  Bubbled,
  CharacterPresenceDto,
  ChainOrigin,
  ConnectionDto,
  ConnectionType,
  MapSourceDto,
  MapSystemDto,
  MassStatus,
  Position,
  ProvenanceDto,
  ShareLevel,
  ShareScope,
  ShipSize,
  SignatureDto,
  SignatureGroup,
  SystemStatus,
  TimeStatus,
} from '@darkbeacon/shared';
import { mergedId, parsePair, parseRefId, parseSignatureKey, refId } from './keys.js';
import type { ChainMerge, MergedObject } from './merge.js';

/** The source id of a map's own objects in its own merged view. */
export const SELF = 'self';

/** One map merged into a view: the map's own objects (`self`) or a share. */
export interface SourceInfo {
  id: string;
  origin: ChainOrigin;
  name: string;
  instanceName: string | null;
  level: ShareLevel;
  /** `all` for the map's own objects. */
  scopes: readonly ShareScope[] | 'all';
  hidden: boolean;
  /** On a composite: where its new objects go. */
  defaultWrite?: boolean;
}

export function sourceDto(source: SourceInfo): MapSourceDto {
  return {
    id: source.id,
    origin: source.origin,
    name: source.name,
    instanceName: source.instanceName,
    level: source.level,
    scopes:
      source.scopes === 'all'
        ? ['topology', 'connectionStatus', 'signatures', 'intel', 'characters', 'labels']
        : [...source.scopes],
    hidden: source.hidden,
  };
}

export type ViewEntity =
  | { kind: 'system'; id: string; dto: MapSystemDto }
  | { kind: 'connection'; id: string; dto: ConnectionDto }
  | { kind: 'signature'; id: string; dto: SignatureDto }
  | { kind: 'character'; id: string; dto: CharacterPresenceDto };

export type ViewKind = ViewEntity['kind'];

/** `kind|id` of a view entity. */
export const viewKey = (kind: ViewKind, id: string) => `${kind}|${id}`;

/** The merge ref a view entity comes from. */
export function refOfView(kind: ViewKind, id: string): string {
  if (kind === 'connection') return refId('connection', id.slice(2).split(':')[0]!);
  if (kind === 'signature') return refId('signature', id.slice(2));
  return refId(kind, id);
}

export interface ViewContext {
  mapId: string;
  /** The merged sources, by id (hidden ones are not merged at all). */
  sources: ReadonlyMap<string, SourceInfo>;
  /** The map's own positions of systems. */
  layout: ReadonlyMap<number, Position>;
  /** A composite's own notes, label assignments and locks, over the merged ones. */
  local?: ReadonlyMap<number, { notes: string | null; labelIds: string[]; locked: boolean }>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function provenance(object: MergedObject, ctx: ViewContext): ProvenanceDto {
  return {
    sources: object.holders,
    updatedBy: object.updatedBy,
    updatedAt: object.updatedAt,
    writable: object.holders.some((id) => {
      const source = ctx.sources.get(id);
      return source !== undefined && (source.id === SELF || source.level === 'read-write');
    }),
  };
}

/** The position hint a source gave (`pos`), if it is one. */
export function positionHint(object: MergedObject): Position | null {
  const pos = obj(object.fields.pos);
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x === null || y === null ? null : { x, y };
}

export function systemDto(object: MergedObject, ctx: ViewContext): MapSystemDto {
  const solarSystemId = Number(object.key);
  const f = object.fields;
  const local = ctx.local?.get(solarSystemId);
  return {
    mapId: ctx.mapId,
    solarSystemId,
    position: ctx.layout.get(solarSystemId) ?? positionHint(object) ?? { x: 0, y: 0 },
    customName: str(f.customName),
    temporaryName: str(f.label),
    tag: str(f.tag),
    status: (str(f.status) as SystemStatus | null) ?? 'unknown',
    description: local?.notes ?? str(f.notes) ?? '',
    labelIds:
      local?.labelIds ??
      (Array.isArray(f.labelIds) ? f.labelIds.filter((x): x is string => typeof x === 'string') : []),
    locked: local?.locked ?? f.locked === true,
    visible: true,
    createdAt: object.born,
    updatedAt: object.updatedAt,
    provenance: provenance(object, ctx),
  };
}

/** Wire `low|high` bubbles to a connection drawn from `source` (the lower id) to `target`. */
function bubbledOf(value: unknown): Bubbled {
  if (value === 'low') return 'source';
  if (value === 'high') return 'target';
  if (value === 'both') return 'both';
  return 'none';
}

export function connectionDto(object: MergedObject, ctx: ViewContext): ConnectionDto {
  const pair = parsePair(object.key.split(':')[0]!)!;
  const f = object.fields;
  const time = obj(f.time);
  const mass = obj(f.mass);
  return {
    id: mergedId.connection(object.key),
    mapId: ctx.mapId,
    source: pair[0],
    target: pair[1],
    type: (str(f.kind) as ConnectionType | null) ?? 'wormhole',
    timeStatus: (str(time?.status) as TimeStatus | null) ?? 'normal',
    massStatus: (str(mass?.status) as MassStatus | null) ?? 'fresh',
    shipSize: (str(f.size) as ShipSize | null) ?? 'large',
    massSaved: f.massSaved === true,
    dangerous: f.dangerous === true,
    bubbled: bubbledOf(f.bubbled),
    eolAt: num(time?.eolAt),
    massStatusAt: num(mass?.at),
    createdAt: object.born,
    updatedAt: object.updatedAt,
    provenance: provenance(object, ctx),
  };
}

export function signatureDto(
  object: MergedObject,
  ctx: ViewContext,
  connectionId: string | null,
): SignatureDto {
  const { solarSystemId, eveId } = parseSignatureKey(object.key)!;
  const f = object.fields;
  return {
    id: mergedId.signature(object.key),
    mapId: ctx.mapId,
    solarSystemId,
    eveId,
    group: (str(f.group) as SignatureGroup | null) ?? 'unknown',
    type: str(f.type),
    name: str(f.name),
    description: str(f.notes) ?? '',
    connectionId,
    tempName: str(f.tempName),
    destination: str(f.destination) as SignatureDto['destination'],
    timeStatus: str(f.time) as SignatureDto['timeStatus'],
    massStatus: str(f.mass) as SignatureDto['massStatus'],
    bubbled: f.bubbled === true,
    createdAt: object.born,
    updatedAt: object.updatedAt,
    provenance: provenance(object, ctx),
  };
}

export function characterDto(object: MergedObject): CharacterPresenceDto {
  const f = object.fields;
  const ship = obj(f.ship);
  return {
    characterId: Number(object.key),
    // Accounts are known for the map's own characters only; shared ones belong to someone elsewhere.
    accountId: str(f.account) ?? 'shared',
    name: str(f.name) ?? 'Unknown pilot',
    solarSystemId: num(f.location),
    shipTypeId: num(ship?.typeId),
    shipName: str(ship?.name),
    online: f.online === true,
    updatedAt: object.updatedAt,
  };
}

/**
 * The view entities one merge ref shows on the map: none, one, or (connections) one per hole.
 * Connections need both systems shown, signatures their system.
 */
export function entitiesOf(merge: ChainMerge, ref: string, ctx: ViewContext): ViewEntity[] {
  const { kind, key } = parseRefId(ref);
  const objects = merge.objects(ref);
  if (objects.length === 0) return [];
  const shown = (solarSystemId: number) => merge.objects(refId('system', String(solarSystemId))).length > 0;
  switch (kind) {
    case 'system': {
      const dto = systemDto(objects[0]!, ctx);
      return [{ kind, id: String(dto.solarSystemId), dto }];
    }
    case 'connection': {
      const pair = parsePair(key);
      if (!pair || !shown(pair[0]) || !shown(pair[1])) return [];
      return objects.map((object) => {
        const dto = connectionDto(object, ctx);
        return { kind, id: dto.id, dto };
      });
    }
    case 'signature': {
      const sig = parseSignatureKey(key);
      if (!sig || !shown(sig.solarSystemId)) return [];
      const object = objects[0]!;
      const dto = signatureDto(object, ctx, linkedConnection(merge, object));
      return [{ kind, id: dto.id, dto }];
    }
    case 'character': {
      const dto = characterDto(objects[0]!);
      return [{ kind, id: String(dto.characterId), dto }];
    }
  }
}

/** The merged connection a signature leads through: the hole of its type on that pair, else the first. */
function linkedConnection(merge: ChainMerge, signature: MergedObject): string | null {
  const pair = str(signature.fields.link);
  if (!pair) return null;
  const holes = merge.objects(refId('connection', pair));
  if (holes.length === 0) return null;
  const pairs = parsePair(pair);
  const sigSystem = parseSignatureKey(signature.key)?.solarSystemId;
  if (!pairs || sigSystem === undefined || !pairs.includes(sigSystem)) return null;
  const type = str(signature.fields.type);
  const hole = holes.find((h) => type !== null && h.fields.whType === type) ?? holes[0]!;
  return mergedId.connection(hole.key);
}

/** What changed for one view entity between two views. */
export interface ViewChange {
  before: ViewEntity | null;
  after: ViewEntity | null;
}

/**
 * The emitted state of a merged map: every entity its viewers have, by `kind|id`, with an index
 * from merge refs to the entities they produced.
 */
export class ViewState {
  private readonly entities = new Map<string, ViewEntity>();
  private readonly byRef = new Map<string, Set<string>>();

  constructor(entities: Iterable<ViewEntity> = []) {
    for (const entity of entities) this.put(entity);
  }

  get size(): number {
    return this.entities.size;
  }

  all(): IterableIterator<ViewEntity> {
    return this.entities.values();
  }

  get(kind: ViewKind, id: string): ViewEntity | undefined {
    return this.entities.get(viewKey(kind, id));
  }

  ofRef(ref: string): ViewEntity[] {
    return [...(this.byRef.get(ref) ?? [])].map((k) => this.entities.get(k)!).filter(Boolean);
  }

  refs(): string[] {
    return [...this.byRef.keys()];
  }

  put(entity: ViewEntity): void {
    const key = viewKey(entity.kind, entity.id);
    this.entities.set(key, entity);
    const ref = refOfView(entity.kind, entity.id);
    let set = this.byRef.get(ref);
    if (!set) this.byRef.set(ref, (set = new Set()));
    set.add(key);
  }

  delete(kind: ViewKind, id: string): void {
    const key = viewKey(kind, id);
    this.entities.delete(key);
    const ref = refOfView(kind, id);
    const set = this.byRef.get(ref);
    set?.delete(key);
    if (set?.size === 0) this.byRef.delete(ref);
  }

  /** The changes that turn this state's entities of `refs` into `next` (entities of the same refs). */
  diff(refs: Iterable<string>, next: readonly ViewEntity[]): ViewChange[] {
    const wanted = new Map(next.map((e) => [viewKey(e.kind, e.id), e]));
    const changes: ViewChange[] = [];
    for (const ref of refs) {
      for (const before of this.ofRef(ref)) {
        const after = wanted.get(viewKey(before.kind, before.id));
        if (!after) changes.push({ before, after: null });
        else if (JSON.stringify(after.dto) !== JSON.stringify(before.dto)) changes.push({ before, after });
        wanted.delete(viewKey(before.kind, before.id));
      }
    }
    for (const after of wanted.values()) changes.push({ before: null, after });
    return sortChanges(changes);
  }

  apply(changes: readonly ViewChange[]): void {
    for (const change of changes) {
      if (change.after) this.put(change.after);
      else if (change.before) this.delete(change.before.kind, change.before.id);
    }
  }
}

const ADD_ORDER: Record<ViewKind, number> = { system: 0, connection: 1, signature: 2, character: 3 };

/** Removals first (signatures, connections, then systems), then additions and updates (systems first). */
export function sortChanges(changes: ViewChange[]): ViewChange[] {
  const rank = (c: ViewChange) =>
    c.after ? 10 + ADD_ORDER[c.after.kind] : 3 - ADD_ORDER[(c.before as ViewEntity).kind];
  return changes.sort((a, b) => rank(a) - rank(b));
}
