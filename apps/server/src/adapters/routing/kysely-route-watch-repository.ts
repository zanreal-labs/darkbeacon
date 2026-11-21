import { json, type Database } from '@darkbeacon/db';
import type { RouteWatchRecord, RouteWatchRepository } from '@darkbeacon/routing';
import type { RouteWatchMode, RouteWatchRouteDto } from '@darkbeacon/shared';

interface RouteWatchRow {
  id: string;
  map_id: string;
  account_id: string;
  target_system_id: number;
  max_jumps: number;
  mode: string;
  expires_at: number;
  /** `open` while a way home is announced, else `waiting`. */
  state: string;
  open_since: number | null;
  missing_since: number | null;
  last_notified_at: number | null;
  last_mouth: number | null;
  closed_at: number | null;
  route: string | null;
  created_at: number;
}

interface Tables {
  routing_route_watches: RouteWatchRow;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

const toRecord = (r: RouteWatchRow): RouteWatchRecord => ({
  id: r.id,
  mapId: r.map_id,
  accountId: r.account_id,
  targetSystemId: Number(r.target_system_id),
  maxJumps: Number(r.max_jumps),
  mode: (r.mode === 'shortest' ? 'shortest' : 'highsec') satisfies RouteWatchMode,
  expiresAt: Number(r.expires_at),
  createdAt: Number(r.created_at),
  state: {
    open: r.state === 'open',
    mouthId: num(r.last_mouth),
    openSince: num(r.open_since),
    missingSince: num(r.missing_since),
    lastNotifiedAt: num(r.last_notified_at),
    closedAt: num(r.closed_at),
  },
  route: json.decode<RouteWatchRouteDto>(r.route),
});

const stateColumns = (w: RouteWatchRecord) => ({
  state: w.state.open ? 'open' : 'waiting',
  open_since: w.state.openSince,
  missing_since: w.state.missingSince,
  last_notified_at: w.state.lastNotifiedAt,
  last_mouth: w.state.mouthId,
  closed_at: w.state.closedAt,
  route: w.route ? json.encode(w.route) : null,
});

export class KyselyRouteWatchRepository implements RouteWatchRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<Tables>();
  }

  async list(mapId: string): Promise<RouteWatchRecord[]> {
    const rows = await this.db
      .selectFrom('routing_route_watches')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toRecord);
  }

  async find(mapId: string, id: string): Promise<RouteWatchRecord | null> {
    const row = await this.db
      .selectFrom('routing_route_watches')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async insert(w: RouteWatchRecord): Promise<void> {
    await this.db
      .insertInto('routing_route_watches')
      .values({
        id: w.id,
        map_id: w.mapId,
        account_id: w.accountId,
        target_system_id: w.targetSystemId,
        max_jumps: w.maxJumps,
        mode: w.mode,
        expires_at: w.expiresAt,
        created_at: w.createdAt,
        ...stateColumns(w),
      })
      .execute();
  }

  async save(w: RouteWatchRecord): Promise<void> {
    await this.db
      .updateTable('routing_route_watches')
      .set(stateColumns(w))
      .where('map_id', '=', w.mapId)
      .where('id', '=', w.id)
      .execute();
  }

  async remove(mapId: string, id: string): Promise<void> {
    await this.db
      .deleteFrom('routing_route_watches')
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .execute();
  }

  async mapsWithWatches(): Promise<string[]> {
    const rows = await this.db.selectFrom('routing_route_watches').select('map_id').distinct().execute();
    return rows.map((r) => r.map_id);
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('routing_route_watches').where('map_id', '=', mapId).execute();
  }
}
