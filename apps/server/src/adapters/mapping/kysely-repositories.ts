import { ConflictError } from '@darkbeacon/core';
import { bool, isUniqueViolation, json, type Database } from '@darkbeacon/db';
import {
  stampChanges,
  type ChainMap,
  type ChangeStamps,
  type Connection,
  type FieldTimes,
  type StampedKind,
  type ConnectionRepository,
  type MapRepository,
  type MapSystem,
  type Passage,
  type PassageRepository,
  type Signature,
  type SignatureRepository,
  type SystemRepository,
} from '@darkbeacon/mapping';

export interface MappingTables {
  maps: {
    id: string;
    slug: string;
    name: string;
    owner_account_id: string;
    /** `standard` or `composite`. */
    kind: string;
    settings: string;
    /** The map's Tags. */
    labels: string;
    /** The map's Labels (WH1, WH2...). */
    system_labels: string;
    created_at: number;
    updated_at: number;
    description: string;
    /** Set while the map is deleted but restorable. */
    deleted_at: number | null;
  };
  map_systems: {
    map_id: string;
    solar_system_id: number;
    x: number;
    y: number;
    custom_name: string | null;
    temporary_name: string | null;
    tag: string | null;
    status: string;
    description: string;
    label_ids: string;
    system_label_ids: string;
    custom_label: string | null;
    locked: number;
    visible: number;
    created_at: number;
    updated_at: number;
    /** JSON field -> when it last changed; see `ChangeStamps`. */
    field_times: string;
  };
  map_connections: {
    id: string;
    map_id: string;
    source: number;
    target: number;
    type: string;
    time_status: string;
    mass_status: string;
    ship_size: string;
    mass_saved: number;
    dangerous: number;
    bubbled: string;
    eol_at: number | null;
    mass_status_at: number | null;
    bookmark_number: number | null;
    bookmark_parent: number | null;
    created_at: number;
    updated_at: number;
    /** min(source, target) and max(source, target): unique per map. */
    pair_low: number;
    pair_high: number;
    /** JSON field -> when it last changed; see `ChangeStamps`. */
    field_times: string;
  };
  map_signatures: {
    id: string;
    map_id: string;
    solar_system_id: number;
    eve_id: string;
    sig_group: string;
    type: string | null;
    name: string | null;
    description: string;
    connection_id: string | null;
    created_at: number;
    updated_at: number;
    /** JSON field -> when it last changed; see `ChangeStamps`. */
    field_times: string;
  };
  map_tombstones: { map_id: string; kind: string; key: string; deleted_at: number };
  map_connection_passages: {
    id: string;
    map_id: string;
    connection_id: string;
    character_id: number | null;
    ship_type_id: number | null;
    mass: number | null;
    from_system: number;
    to_system: number;
    occurred_at: number;
    event_id: string | null;
    source: string;
    mass_mode: string;
    higgs: number;
    entangler: number;
    note: string | null;
    created_by: string | null;
  };
}

type MapRow = MappingTables['maps'];
type SystemRow = MappingTables['map_systems'];
type ConnectionRow = MappingTables['map_connections'];
type SignatureRow = MappingTables['map_signatures'];
type PassageRow = MappingTables['map_connection_passages'];

abstract class Repository {
  constructor(private readonly database: Database) {}

  protected get db() {
    return this.database.db<MappingTables>();
  }
}

export class KyselyMapRepository extends Repository implements MapRepository {
  async findById(id: string): Promise<ChainMap | null> {
    const row = await this.db.selectFrom('maps').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapFromRow(row) : null;
  }

  async findBySlug(slug: string): Promise<ChainMap | null> {
    const row = await this.db.selectFrom('maps').selectAll().where('slug', '=', slug).executeTakeFirst();
    return row ? mapFromRow(row) : null;
  }

  async listByIds(ids: readonly string[]): Promise<ChainMap[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.selectFrom('maps').selectAll().where('id', 'in', ids).execute();
    return rows.map(mapFromRow);
  }

  async listOwnedBy(accountId: string): Promise<ChainMap[]> {
    const rows = await this.db
      .selectFrom('maps')
      .selectAll()
      .where('owner_account_id', '=', accountId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
    return rows.map(mapFromRow);
  }

  async allIds(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('maps')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => r.id);
  }

  async listAll(): Promise<ChainMap[]> {
    const rows = await this.db.selectFrom('maps').selectAll().orderBy('created_at').orderBy('id').execute();
    return rows.map(mapFromRow);
  }

  async insert(map: ChainMap): Promise<void> {
    await this.db.insertInto('maps').values(mapToRow(map)).execute().catch(slugConflict(map.slug));
  }

  async update(map: ChainMap): Promise<void> {
    const { id, ...row } = mapToRow(map);
    await this.db.updateTable('maps').set(row).where('id', '=', id).execute().catch(slugConflict(map.slug));
  }

  /** Systems, connections and signatures go with it (ON DELETE CASCADE). */
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('maps').where('id', '=', id).execute();
  }
}

function slugConflict(slug: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ConflictError(`The address ${slug} is taken`);
    throw error;
  };
}

export class KyselySystemRepository extends Repository implements SystemRepository {
  async countVisibleByMap(): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('map_systems')
      .select(['map_id', (eb) => eb.fn.countAll<number | string>().as('n')])
      .where('visible', '=', bool.encode(true))
      .groupBy('map_id')
      .execute();
    return new Map(rows.map((r) => [r.map_id, Number(r.n)]));
  }

  async list(mapId: string): Promise<MapSystem[]> {
    const rows = await this.db
      .selectFrom('map_systems')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('solar_system_id')
      .execute();
    return rows.map(systemFromRow);
  }

  async find(mapId: string, solarSystemId: number): Promise<MapSystem | null> {
    const row = await this.db
      .selectFrom('map_systems')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('solar_system_id', '=', solarSystemId)
      .executeTakeFirst();
    return row ? systemFromRow(row) : null;
  }

  async insert(system: MapSystem): Promise<void> {
    await this.db
      .insertInto('map_systems')
      .values({ ...systemToRow(system), field_times: '{}' })
      .execute();
  }

  async update(system: MapSystem): Promise<void> {
    const { map_id, solar_system_id, ...row } = systemToRow(system);
    const current = await this.db
      .selectFrom('map_systems')
      .selectAll()
      .where('map_id', '=', map_id)
      .where('solar_system_id', '=', solar_system_id)
      .executeTakeFirst();
    await this.db
      .updateTable('map_systems')
      .set({ ...row, ...stamped(current, systemFromRow, system) })
      .where('map_id', '=', map_id)
      .where('solar_system_id', '=', solar_system_id)
      .execute();
  }

  async delete(mapId: string, solarSystemId: number): Promise<void> {
    await this.db
      .deleteFrom('map_systems')
      .where('map_id', '=', mapId)
      .where('solar_system_id', '=', solarSystemId)
      .execute();
  }
}

export class KyselyConnectionRepository extends Repository implements ConnectionRepository {
  async list(mapId: string): Promise<Connection[]> {
    const rows = await this.db
      .selectFrom('map_connections')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('id')
      .execute();
    return rows.map(connectionFromRow);
  }

  async findById(mapId: string, id: string): Promise<Connection | null> {
    const row = await this.db
      .selectFrom('map_connections')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? connectionFromRow(row) : null;
  }

  async findBetween(mapId: string, a: number, b: number): Promise<Connection | null> {
    const row = await this.db
      .selectFrom('map_connections')
      .selectAll()
      .where('map_id', '=', mapId)
      .where((eb) =>
        eb.or([
          eb.and([eb('source', '=', a), eb('target', '=', b)]),
          eb.and([eb('source', '=', b), eb('target', '=', a)]),
        ]),
      )
      .executeTakeFirst();
    return row ? connectionFromRow(row) : null;
  }

  async listForSystem(mapId: string, solarSystemId: number): Promise<Connection[]> {
    const rows = await this.db
      .selectFrom('map_connections')
      .selectAll()
      .where('map_id', '=', mapId)
      .where((eb) => eb.or([eb('source', '=', solarSystemId), eb('target', '=', solarSystemId)]))
      .orderBy('id')
      .execute();
    return rows.map(connectionFromRow);
  }

  async insert(connection: Connection): Promise<boolean> {
    // A concurrent insert of the same pair wins; this one then inserts nothing.
    const row = await this.db
      .insertInto('map_connections')
      .values({ ...connectionToRow(connection), field_times: '{}' })
      .onConflict((oc) => oc.columns(['map_id', 'pair_low', 'pair_high']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async update(connection: Connection): Promise<void> {
    const { id, map_id, ...row } = connectionToRow(connection);
    const current = await this.db
      .selectFrom('map_connections')
      .selectAll()
      .where('map_id', '=', map_id)
      .where('id', '=', id)
      .executeTakeFirst();
    await this.db
      .updateTable('map_connections')
      .set({ ...row, ...stamped(current, connectionFromRow, connection) })
      .where('map_id', '=', map_id)
      .where('id', '=', id)
      .execute();
  }

  async delete(mapId: string, id: string): Promise<void> {
    await this.db.deleteFrom('map_connections').where('map_id', '=', mapId).where('id', '=', id).execute();
  }

  async mapsWithUnnumberedWormholes(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('map_connections')
      .select('map_id')
      .distinct()
      .where('type', '=', 'wormhole')
      .where('bookmark_number', 'is', null)
      .orderBy('map_id')
      .execute();
    return rows.map((r) => r.map_id);
  }
}

export class KyselySignatureRepository extends Repository implements SignatureRepository {
  async listForMap(mapId: string): Promise<Signature[]> {
    const rows = await this.db
      .selectFrom('map_signatures')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('solar_system_id')
      .orderBy('eve_id')
      .execute();
    return rows.map(signatureFromRow);
  }

  async listForSystem(mapId: string, solarSystemId: number): Promise<Signature[]> {
    const rows = await this.db
      .selectFrom('map_signatures')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('solar_system_id', '=', solarSystemId)
      .orderBy('eve_id')
      .execute();
    return rows.map(signatureFromRow);
  }

  async findById(mapId: string, id: string): Promise<Signature | null> {
    const row = await this.db
      .selectFrom('map_signatures')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? signatureFromRow(row) : null;
  }

  async insert(signature: Signature): Promise<void> {
    await this.db
      .insertInto('map_signatures')
      .values({ ...signatureToRow(signature), field_times: '{}' })
      .execute()
      .catch(signatureConflict(signature.eveId));
  }

  async update(signature: Signature): Promise<void> {
    const { id, map_id, ...row } = signatureToRow(signature);
    const current = await this.db
      .selectFrom('map_signatures')
      .selectAll()
      .where('map_id', '=', map_id)
      .where('id', '=', id)
      .executeTakeFirst();
    await this.db
      .updateTable('map_signatures')
      .set({ ...row, ...stamped(current, signatureFromRow, signature) })
      .where('map_id', '=', map_id)
      .where('id', '=', id)
      .execute()
      .catch(signatureConflict(signature.eveId));
  }

  async delete(mapId: string, id: string): Promise<void> {
    await this.db.deleteFrom('map_signatures').where('map_id', '=', mapId).where('id', '=', id).execute();
  }
}

export class KyselyPassageRepository extends Repository implements PassageRepository {
  async insert(mapId: string, passage: Passage, eventId: string | null): Promise<boolean> {
    const row = await this.db
      .insertInto('map_connection_passages')
      .values(passageToRow(mapId, passage, eventId))
      .onConflict((oc) => oc.column('event_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async findById(mapId: string, id: string): Promise<Passage | null> {
    const row = await this.db
      .selectFrom('map_connection_passages')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? passageFromRow(row) : null;
  }

  async update(mapId: string, passage: Passage): Promise<void> {
    await this.db
      .updateTable('map_connection_passages')
      .set({
        mass: passage.mass,
        mass_mode: passage.massMode,
        higgs: bool.encode(passage.higgs),
        entangler: bool.encode(passage.entangler),
        note: passage.note,
      })
      .where('map_id', '=', mapId)
      .where('id', '=', passage.id)
      .execute();
  }

  async delete(mapId: string, id: string): Promise<void> {
    await this.db
      .deleteFrom('map_connection_passages')
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .execute();
  }

  async listForMap(mapId: string): Promise<Passage[]> {
    const rows = await this.db
      .selectFrom('map_connection_passages')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    return rows.map(passageFromRow);
  }

  async listForConnection(mapId: string, connectionId: string): Promise<Passage[]> {
    const rows = await this.db
      .selectFrom('map_connection_passages')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('connection_id', '=', connectionId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map(passageFromRow);
  }
}

/**
 * The `field_times` of a row about to become `next`: fields that change are stamped with
 * `next.updatedAt` (the time of the change), the others keep theirs.
 */
function stamped<R extends { field_times: string }, T extends { updatedAt: number }>(
  current: R | undefined,
  fromRow: (row: R) => T,
  next: T,
): { field_times: string } | Record<string, never> {
  if (!current) return {};
  const times = json.decode<FieldTimes>(current.field_times) ?? {};
  return { field_times: json.encode(stampChanges(fromRow(current), next, times, next.updatedAt)) };
}

const STAMPED_TABLES = {
  system: { table: 'map_systems', id: 'solar_system_id' },
  connection: { table: 'map_connections', id: 'id' },
  signature: { table: 'map_signatures', id: 'id' },
} as const;

/** Field times kept by the repositories above, and tombstones of deliberate deletions. */
export class KyselyChangeStamps extends Repository implements ChangeStamps {
  async fieldTimes(
    mapId: string,
    kind: StampedKind,
    ids?: readonly string[],
  ): Promise<Map<string, FieldTimes>> {
    if (ids?.length === 0) return new Map();
    const { table, id } = STAMPED_TABLES[kind];
    let query = this.db
      .selectFrom(table)
      .select([`${id} as id`, 'field_times'])
      .where('map_id', '=', mapId);
    if (ids) {
      query = query.where(
        id,
        'in',
        kind === 'system' ? ids.map(Number) : [...ids],
      ) as unknown as typeof query;
    }
    const rows = (await query.execute()) as Array<{ id: string | number; field_times: string }>;
    return new Map(rows.map((r) => [String(r.id), json.decode<FieldTimes>(r.field_times) ?? {}]));
  }

  async tombstones(
    mapId: string,
    kind: 'connection' | 'signature',
    keys?: readonly string[],
  ): Promise<Map<string, number>> {
    if (keys?.length === 0) return new Map();
    let query = this.db
      .selectFrom('map_tombstones')
      .select(['key', 'deleted_at'])
      .where('map_id', '=', mapId)
      .where('kind', '=', kind);
    if (keys) query = query.where('key', 'in', [...keys]);
    const rows = await query.execute();
    return new Map(rows.map((r) => [r.key, Number(r.deleted_at)]));
  }

  async putTombstone(
    mapId: string,
    kind: 'connection' | 'signature',
    key: string,
    at: number,
  ): Promise<void> {
    await this.db
      .insertInto('map_tombstones')
      .values({ map_id: mapId, kind, key, deleted_at: at })
      .onConflict((oc) => oc.columns(['map_id', 'kind', 'key']).doUpdateSet({ deleted_at: at }))
      .execute();
  }

  async pruneTombstones(before: number): Promise<number> {
    const result = await this.db
      .deleteFrom('map_tombstones')
      .where('deleted_at', '<', before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

function passageFromRow(row: PassageRow): Passage {
  return {
    id: row.id,
    connectionId: row.connection_id,
    characterId: row.character_id == null ? null : Number(row.character_id),
    shipTypeId: row.ship_type_id == null ? null : Number(row.ship_type_id),
    mass: row.mass == null ? null : Number(row.mass),
    from: Number(row.from_system),
    to: Number(row.to_system),
    occurredAt: Number(row.occurred_at),
    source: row.source === 'manual' ? 'manual' : 'tracked',
    massMode: row.mass_mode === 'hot' || row.mass_mode === 'custom' ? row.mass_mode : 'cold',
    higgs: bool.decode(row.higgs),
    entangler: bool.decode(row.entangler),
    note: row.note,
    createdBy: row.created_by,
  };
}

function passageToRow(mapId: string, p: Passage, eventId: string | null): PassageRow {
  return {
    id: p.id,
    map_id: mapId,
    connection_id: p.connectionId,
    character_id: p.characterId,
    ship_type_id: p.shipTypeId,
    mass: p.mass,
    from_system: p.from,
    to_system: p.to,
    occurred_at: p.occurredAt,
    event_id: eventId,
    source: p.source,
    mass_mode: p.massMode,
    higgs: bool.encode(p.higgs),
    entangler: bool.encode(p.entangler),
    note: p.note,
    created_by: p.createdBy,
  };
}

function signatureConflict(eveId: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) throw new ConflictError(`Signature ${eveId} already exists`);
    throw error;
  };
}

function mapToRow(map: ChainMap): MapRow {
  return {
    id: map.id,
    slug: map.slug,
    name: map.name,
    kind: map.kind ?? 'standard',
    owner_account_id: map.ownerAccountId,
    settings: json.encode(map.settings),
    labels: json.encode(map.labels),
    system_labels: json.encode(map.systemLabels),
    created_at: map.createdAt,
    updated_at: map.updatedAt,
    description: map.description ?? '',
    deleted_at: map.deletedAt ?? null,
  };
}

function mapFromRow(row: MapRow): ChainMap {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ...(row.kind === 'composite' ? { kind: 'composite' as const } : {}),
    ownerAccountId: row.owner_account_id,
    settings: json.decode<ChainMap['settings']>(row.settings)!,
    labels: json.decode<ChainMap['labels']>(row.labels)!,
    systemLabels: json.decode<ChainMap['systemLabels']>(row.system_labels) ?? [],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    // Left out while empty, so maps read the same as before these existed.
    ...(row.description ? { description: row.description } : {}),
    ...(row.deleted_at === null || row.deleted_at === undefined ? {} : { deletedAt: Number(row.deleted_at) }),
  };
}

function systemToRow(s: MapSystem): Omit<SystemRow, 'field_times'> {
  return {
    map_id: s.mapId,
    solar_system_id: s.solarSystemId,
    x: s.position.x,
    y: s.position.y,
    custom_name: s.customName,
    temporary_name: s.temporaryName,
    tag: s.tag,
    status: s.status,
    description: s.description,
    label_ids: json.encode(s.labelIds),
    system_label_ids: json.encode(s.systemLabelIds),
    custom_label: s.customLabel,
    locked: bool.encode(s.locked),
    visible: bool.encode(s.visible),
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function systemFromRow(row: SystemRow): MapSystem {
  return {
    mapId: row.map_id,
    solarSystemId: Number(row.solar_system_id),
    position: { x: Number(row.x), y: Number(row.y) },
    customName: row.custom_name,
    temporaryName: row.temporary_name,
    tag: row.tag,
    status: row.status as MapSystem['status'],
    description: row.description,
    labelIds: json.decode<string[]>(row.label_ids)!,
    systemLabelIds: json.decode<string[]>(row.system_label_ids) ?? [],
    customLabel: row.custom_label,
    locked: bool.decode(row.locked),
    visible: bool.decode(row.visible),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function connectionToRow(c: Connection): Omit<ConnectionRow, 'field_times'> {
  return {
    id: c.id,
    map_id: c.mapId,
    source: c.source,
    target: c.target,
    type: c.type,
    time_status: c.timeStatus,
    mass_status: c.massStatus,
    ship_size: c.shipSize,
    mass_saved: bool.encode(c.massSaved),
    dangerous: bool.encode(c.dangerous),
    bubbled: c.bubbled,
    eol_at: c.eolAt,
    mass_status_at: c.massStatusAt ?? null,
    bookmark_number: c.bookmarkNumber ?? null,
    bookmark_parent: c.bookmarkParent ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    pair_low: Math.min(c.source, c.target),
    pair_high: Math.max(c.source, c.target),
  };
}

function connectionFromRow(row: ConnectionRow): Connection {
  return {
    id: row.id,
    mapId: row.map_id,
    source: Number(row.source),
    target: Number(row.target),
    type: row.type as Connection['type'],
    timeStatus: row.time_status as Connection['timeStatus'],
    massStatus: row.mass_status as Connection['massStatus'],
    shipSize: row.ship_size as Connection['shipSize'],
    massSaved: bool.decode(row.mass_saved),
    dangerous: bool.decode(row.dangerous),
    bubbled: row.bubbled as Connection['bubbled'],
    eolAt: row.eol_at == null ? null : Number(row.eol_at),
    massStatusAt: row.mass_status_at == null ? null : Number(row.mass_status_at),
    bookmarkNumber: row.bookmark_number == null ? null : Number(row.bookmark_number),
    bookmarkParent: row.bookmark_parent == null ? null : Number(row.bookmark_parent),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function signatureToRow(s: Signature): Omit<SignatureRow, 'field_times'> {
  return {
    id: s.id,
    map_id: s.mapId,
    solar_system_id: s.solarSystemId,
    eve_id: s.eveId,
    sig_group: s.group,
    type: s.type,
    name: s.name,
    description: s.description,
    connection_id: s.connectionId,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

function signatureFromRow(row: SignatureRow): Signature {
  return {
    id: row.id,
    mapId: row.map_id,
    solarSystemId: Number(row.solar_system_id),
    eveId: row.eve_id,
    group: row.sig_group as Signature['group'],
    type: row.type,
    name: row.name,
    description: row.description,
    connectionId: row.connection_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
