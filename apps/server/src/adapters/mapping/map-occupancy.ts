import type { Database } from '@darkbeacon/db';
import type { MapOccupancy } from '@darkbeacon/mapping';

interface OccupancyTables {
  tracked_character: { map_id: string; character_id: number };
  character_presence: { character_id: number; solar_system_id: number | null; online: number };
}

/**
 * Mapping's MapOccupancy over tracking's tables: systems where a character tracked on the map is
 * (online or not: an offline pilot logged off there and will log in there). Read only.
 */
export class KyselyMapOccupancy implements MapOccupancy {
  constructor(private readonly database: Database) {}

  async occupied(mapId: string): Promise<Set<number>> {
    const rows = await this.database
      .db<OccupancyTables>()
      .selectFrom('tracked_character')
      .innerJoin('character_presence', 'character_presence.character_id', 'tracked_character.character_id')
      .select('character_presence.solar_system_id')
      .where('tracked_character.map_id', '=', mapId)
      .where('character_presence.solar_system_id', 'is not', null)
      .execute();
    return new Set(rows.map((r) => Number(r.solar_system_id)));
  }
}
