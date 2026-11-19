import type { Database } from '@darkbeacon/db';
import type { ChainPresence, ChainPresenceRepository } from '@darkbeacon/mapping';

export interface ChainPresenceTables {
  map_chain_presence: {
    map_id: string;
    solar_system_id: number;
    joined_at: number;
    left_at: number | null;
  };
}

type Row = ChainPresenceTables['map_chain_presence'];

const fromRow = (row: Row): ChainPresence => ({
  mapId: row.map_id,
  solarSystemId: Number(row.solar_system_id),
  joinedAt: Number(row.joined_at),
  leftAt: row.left_at === null ? null : Number(row.left_at),
});

/** Rows of `map_chain_presence`, one per map and system its chain ever held (deleted with the map). */
export class KyselyChainPresenceRepository implements ChainPresenceRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<ChainPresenceTables>();
  }

  async list(mapId: string): Promise<ChainPresence[]> {
    const rows = await this.db
      .selectFrom('map_chain_presence')
      .selectAll()
      .where('map_id', '=', mapId)
      .execute();
    return rows.map(fromRow);
  }

  async put(rows: readonly ChainPresence[]): Promise<void> {
    // Small batches: SQLite takes at most 999 bound values per statement.
    for (let i = 0; i < rows.length; i += 200) {
      await this.db
        .insertInto('map_chain_presence')
        .values(
          rows.slice(i, i + 200).map((r) => ({
            map_id: r.mapId,
            solar_system_id: r.solarSystemId,
            joined_at: r.joinedAt,
            left_at: r.leftAt,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['map_id', 'solar_system_id']).doUpdateSet((eb) => ({
            joined_at: eb.ref('excluded.joined_at'),
            left_at: eb.ref('excluded.left_at'),
          })),
        )
        .execute();
    }
  }

  async any(mapId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('map_chain_presence')
      .select('map_id')
      .where('map_id', '=', mapId)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }
}
