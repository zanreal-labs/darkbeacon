import type { Database } from '@darkbeacon/db';
import type { PingRepository } from '@darkbeacon/mapping';
import type { MapPingDto, PingType } from '@darkbeacon/shared';

interface PingTables {
  map_pings: {
    id: string;
    map_id: string;
    solar_system_id: number;
    type: string;
    message: string;
    created_by: string;
    created_by_name: string | null;
    character_id: number | null;
    character_name: string | null;
    created_at: number;
  };
}

type PingRow = PingTables['map_pings'];

function fromRow(row: PingRow): MapPingDto {
  return {
    id: row.id,
    mapId: row.map_id,
    solarSystemId: Number(row.solar_system_id),
    type: row.type as PingType,
    message: row.message,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    characterId: row.character_id == null ? null : Number(row.character_id),
    characterName: row.character_name,
    createdAt: Number(row.created_at),
  };
}

/** Rally pings in `map_pings` (both dialects). */
export class KyselyPingRepository implements PingRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<PingTables>();
  }

  async list(mapId: string): Promise<MapPingDto[]> {
    const rows = await this.db
      .selectFrom('map_pings')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(fromRow);
  }

  async find(mapId: string, id: string): Promise<MapPingDto | null> {
    const row = await this.db
      .selectFrom('map_pings')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? fromRow(row) : null;
  }

  async insert(ping: MapPingDto): Promise<void> {
    await this.db
      .insertInto('map_pings')
      .values({
        id: ping.id,
        map_id: ping.mapId,
        solar_system_id: ping.solarSystemId,
        type: ping.type,
        message: ping.message,
        created_by: ping.createdBy,
        created_by_name: ping.createdByName,
        character_id: ping.characterId,
        character_name: ping.characterName,
        created_at: ping.createdAt,
      })
      .execute();
  }

  async delete(mapId: string, id: string): Promise<void> {
    await this.db.deleteFrom('map_pings').where('map_id', '=', mapId).where('id', '=', id).execute();
  }
}
