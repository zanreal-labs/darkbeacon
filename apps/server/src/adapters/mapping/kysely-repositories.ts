import { ConflictError } from '@darkbeacon/core';
import { bool, isUniqueViolation, json, type Database } from '@darkbeacon/db';
import type {
  ChainMap,
  Connection,
  ConnectionRepository,
  MapRepository,
  MapSystem,
  Passage,
  PassageRepository,
  Signature,
  SignatureRepository,
  SystemRepository,
} from '@darkbeacon/mapping';

export interface MappingTables {
  maps: {
    id: string;
    slug: string;
    name: string;
    owner_account_id: string;
    settings: string;
    labels: string;
    created_at: number;
    updated_at: number;
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
    locked: number;
    visible: number;
    created_at: number;
    updated_at: number;
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
  };
  map_connection_passages: {
    id: string;
    map_id: string;
    connection_id: string;
    character_id: number;
    ship_type_id: number | null;
    mass: number | null;
    from_system: number;
    to_system: number;
    occurred_at: number;
    event_id: string;
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
      .orderBy('name')
      .execute();
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
    await this.db.insertInto('map_systems').values(systemToRow(system)).execute();
  }

  async update(system: MapSystem): Promise<void> {
    const { map_id, solar_system_id, ...row } = systemToRow(system);
    await this.db
      .updateTable('map_systems')
      .set(row)
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
      .values(connectionToRow(connection))
      .onConflict((oc) => oc.columns(['map_id', 'pair_low', 'pair_high']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async update(connection: Connection): Promise<void> {
    const { id, map_id, ...row } = connectionToRow(connection);
    await this.db
      .updateTable('map_connections')
      .set(row)
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
      .values(signatureToRow(signature))
      .execute()
      .catch(signatureConflict(signature.eveId));
  }

  async update(signature: Signature): Promise<void> {
    const { id, map_id, ...row } = signatureToRow(signature);
    await this.db
      .updateTable('map_signatures')
      .set(row)
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
  async insert(mapId: string, passage: Passage, eventId: string): Promise<boolean> {
    const row = await this.db
      .insertInto('map_connection_passages')
      .values({
        id: passage.id,
        map_id: mapId,
        connection_id: passage.connectionId,
        character_id: passage.characterId,
        ship_type_id: passage.shipTypeId,
        mass: passage.mass,
        from_system: passage.from,
        to_system: passage.to,
        occurred_at: passage.occurredAt,
        event_id: eventId,
      })
      .onConflict((oc) => oc.column('event_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
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

function passageFromRow(row: PassageRow): Passage {
  return {
    id: row.id,
    connectionId: row.connection_id,
    characterId: Number(row.character_id),
    shipTypeId: row.ship_type_id == null ? null : Number(row.ship_type_id),
    mass: row.mass == null ? null : Number(row.mass),
    from: Number(row.from_system),
    to: Number(row.to_system),
    occurredAt: Number(row.occurred_at),
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
    owner_account_id: map.ownerAccountId,
    settings: json.encode(map.settings),
    labels: json.encode(map.labels),
    created_at: map.createdAt,
    updated_at: map.updatedAt,
  };
}

function mapFromRow(row: MapRow): ChainMap {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerAccountId: row.owner_account_id,
    settings: json.decode<ChainMap['settings']>(row.settings)!,
    labels: json.decode<ChainMap['labels']>(row.labels)!,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function systemToRow(s: MapSystem): SystemRow {
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
    locked: bool.decode(row.locked),
    visible: bool.decode(row.visible),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function connectionToRow(c: Connection): ConnectionRow {
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

function signatureToRow(s: Signature): SignatureRow {
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
