import { bool, json, type Database } from '@darkbeacon/db';
import type { ChainOrigin, Position, ShareScope } from '@darkbeacon/shared';
import type {
  ChainLayoutRepository,
  ChainViewRepository,
  CompositeMaps,
  Share,
  ShareRepository,
  StoredView,
  ViewEntity,
  ViewKind,
} from '@darkbeacon/sharing';

export interface SharingTables {
  map_shares: {
    id: string;
    source_instance: string;
    source_map_id: string;
    target_instance: string;
    target_map_id: string;
    level: string;
    offered_scopes: string;
    target_scopes: string | null;
    status: string;
    hidden: number;
    offered_by: string;
    accepted_by: string | null;
    offered_at: number;
    accepted_at: number | null;
    updated_at: number;
  };
  chain_views: { map_id: string; sources: string; updated_at: number };
  chain_view_entities: { map_id: string; kind: string; id: string; data: string };
  chain_layout: { map_id: string; solar_system_id: number; x: number; y: number; updated_at: number };
  /** Mapping's table, read for the map kind only. */
  maps: { id: string; kind: string };
}

type ShareRow = SharingTables['map_shares'];

abstract class Repository {
  constructor(private readonly database: Database) {}

  protected get db() {
    return this.database.db<SharingTables>();
  }
}

function shareFromRow(row: ShareRow): Share {
  return {
    id: row.id,
    source: { instance: row.source_instance, mapId: row.source_map_id },
    target: { instance: row.target_instance, mapId: row.target_map_id },
    level: row.level as Share['level'],
    offeredScopes: json.decode<ShareScope[]>(row.offered_scopes) ?? ['topology'],
    targetScopes: json.decode<ShareScope[]>(row.target_scopes),
    status: row.status as Share['status'],
    hidden: bool.decode(row.hidden),
    offeredBy: row.offered_by,
    acceptedBy: row.accepted_by,
    offeredAt: Number(row.offered_at),
    acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
    updatedAt: Number(row.updated_at),
  };
}

function shareToRow(share: Share): ShareRow {
  return {
    id: share.id,
    source_instance: share.source.instance,
    source_map_id: share.source.mapId,
    target_instance: share.target.instance,
    target_map_id: share.target.mapId,
    level: share.level,
    offered_scopes: json.encode(share.offeredScopes),
    target_scopes: share.targetScopes === null ? null : json.encode(share.targetScopes),
    status: share.status,
    hidden: bool.encode(share.hidden),
    offered_by: share.offeredBy,
    accepted_by: share.acceptedBy,
    offered_at: share.offeredAt,
    accepted_at: share.acceptedAt,
    updated_at: share.updatedAt,
  };
}

export class KyselyShareRepository extends Repository implements ShareRepository {
  async findById(id: string): Promise<Share | null> {
    const row = await this.db.selectFrom('map_shares').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? shareFromRow(row) : null;
  }

  async listForMap(origin: ChainOrigin): Promise<Share[]> {
    const rows = await this.db
      .selectFrom('map_shares')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb.and([eb('source_instance', '=', origin.instance), eb('source_map_id', '=', origin.mapId)]),
          eb.and([eb('target_instance', '=', origin.instance), eb('target_map_id', '=', origin.mapId)]),
        ]),
      )
      .orderBy('offered_at')
      .orderBy('id')
      .execute();
    return rows.map(shareFromRow);
  }

  async listActiveForTarget(target: ChainOrigin): Promise<Share[]> {
    const rows = await this.db
      .selectFrom('map_shares')
      .selectAll()
      .where('target_instance', '=', target.instance)
      .where('target_map_id', '=', target.mapId)
      .where('status', '=', 'active')
      .orderBy('accepted_at')
      .orderBy('id')
      .execute();
    return rows.map(shareFromRow);
  }

  async listActive(): Promise<Share[]> {
    const rows = await this.db
      .selectFrom('map_shares')
      .selectAll()
      .where('status', '=', 'active')
      .orderBy('accepted_at')
      .orderBy('id')
      .execute();
    return rows.map(shareFromRow);
  }

  async insert(share: Share): Promise<void> {
    await this.db.insertInto('map_shares').values(shareToRow(share)).execute();
  }

  async update(share: Share): Promise<void> {
    const { id, ...row } = shareToRow(share);
    await this.db.updateTable('map_shares').set(row).where('id', '=', id).execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('map_shares').where('id', '=', id).execute();
  }

  async deleteForMap(origin: ChainOrigin): Promise<Share[]> {
    const shares = await this.listForMap(origin);
    if (shares.length > 0)
      await this.db
        .deleteFrom('map_shares')
        .where(
          'id',
          'in',
          shares.map((s) => s.id),
        )
        .execute();
    return shares;
  }
}

const PAGE = 200;

export class KyselyChainViewRepository extends Repository implements ChainViewRepository {
  async load(mapId: string): Promise<StoredView> {
    const head = await this.db
      .selectFrom('chain_views')
      .select('sources')
      .where('map_id', '=', mapId)
      .executeTakeFirst();
    if (!head) return { sources: null, entities: [] };
    const rows = await this.db
      .selectFrom('chain_view_entities')
      .select(['kind', 'id', 'data'])
      .where('map_id', '=', mapId)
      .execute();
    return {
      sources: json.decode<unknown[]>(head.sources) ?? [],
      entities: rows.map((r) => ({ kind: r.kind, id: r.id, dto: json.decode(r.data) }) as ViewEntity),
    };
  }

  async loadKinds(mapId: string, kinds: readonly ViewKind[]): Promise<ViewEntity[]> {
    if (kinds.length === 0) return [];
    const rows = await this.db
      .selectFrom('chain_view_entities')
      .select(['kind', 'id', 'data'])
      .where('map_id', '=', mapId)
      .where('kind', 'in', [...kinds])
      .execute();
    return rows.map((r) => ({ kind: r.kind, id: r.id, dto: json.decode(r.data) }) as ViewEntity);
  }

  async saveSources(mapId: string, sources: unknown[]): Promise<void> {
    const row = { map_id: mapId, sources: json.encode(sources), updated_at: Date.now() };
    await this.db
      .insertInto('chain_views')
      .values(row)
      .onConflict((oc) =>
        oc.column('map_id').doUpdateSet({ sources: row.sources, updated_at: row.updated_at }),
      )
      .execute();
  }

  async put(mapId: string, entities: readonly ViewEntity[]): Promise<void> {
    for (let i = 0; i < entities.length; i += PAGE) {
      const rows = entities
        .slice(i, i + PAGE)
        .map((e) => ({ map_id: mapId, kind: e.kind, id: e.id, data: json.encode(e.dto) }));
      await this.db
        .insertInto('chain_view_entities')
        .values(rows)
        .onConflict((oc) =>
          oc.columns(['map_id', 'kind', 'id']).doUpdateSet((eb) => ({ data: eb.ref('excluded.data') })),
        )
        .execute();
    }
  }

  async remove(mapId: string, entities: ReadonlyArray<{ kind: ViewKind; id: string }>): Promise<void> {
    for (const e of entities) {
      await this.db
        .deleteFrom('chain_view_entities')
        .where('map_id', '=', mapId)
        .where('kind', '=', e.kind)
        .where('id', '=', e.id)
        .execute();
    }
  }

  async clear(mapId: string): Promise<void> {
    await this.db.deleteFrom('chain_view_entities').where('map_id', '=', mapId).execute();
    await this.db.deleteFrom('chain_views').where('map_id', '=', mapId).execute();
  }

  async mapsWithView(): Promise<string[]> {
    const rows = await this.db.selectFrom('chain_views').select('map_id').execute();
    return rows.map((r) => r.map_id);
  }
}

export class KyselyChainLayoutRepository extends Repository implements ChainLayoutRepository {
  async list(mapId: string): Promise<Map<number, Position>> {
    const rows = await this.db.selectFrom('chain_layout').selectAll().where('map_id', '=', mapId).execute();
    return new Map(rows.map((r) => [Number(r.solar_system_id), { x: Number(r.x), y: Number(r.y) }]));
  }

  async put(
    mapId: string,
    positions: ReadonlyArray<{ solarSystemId: number; position: Position }>,
    at: number,
  ): Promise<void> {
    for (let i = 0; i < positions.length; i += PAGE) {
      const rows = positions.slice(i, i + PAGE).map((p) => ({
        map_id: mapId,
        solar_system_id: p.solarSystemId,
        x: p.position.x,
        y: p.position.y,
        updated_at: at,
      }));
      await this.db
        .insertInto('chain_layout')
        .values(rows)
        .onConflict((oc) =>
          oc.columns(['map_id', 'solar_system_id']).doUpdateSet((eb) => ({
            x: eb.ref('excluded.x'),
            y: eb.ref('excluded.y'),
            updated_at: eb.ref('excluded.updated_at'),
          })),
        )
        .execute();
    }
  }

  async clear(mapId: string): Promise<void> {
    await this.db.deleteFrom('chain_layout').where('map_id', '=', mapId).execute();
  }
}

/** Composite maps, by mapping's `kind` column. */
export class KyselyCompositeMaps extends Repository implements CompositeMaps {
  async listComposites(): Promise<string[]> {
    const rows = await this.db.selectFrom('maps').select('id').where('kind', '=', 'composite').execute();
    return rows.map((r) => r.id);
  }
}
