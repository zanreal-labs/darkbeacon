import { json, type Database } from '@darkbeacon/db';
import type { MapPreferenceRepository, MapPreferences } from '@darkbeacon/mapping';

export interface MapPreferenceTables {
  map_preferences: {
    map_id: string;
    account_id: string;
    viewport: string | null;
    bookmark_template: string | null;
    updated_at: number;
  };
}

/** Rows of `map_preferences`, one per map and account (deleted with the map). */
export class KyselyMapPreferenceRepository implements MapPreferenceRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<MapPreferenceTables>();
  }

  async find(mapId: string, accountId: string): Promise<MapPreferences | null> {
    const row = await this.db
      .selectFrom('map_preferences')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      mapId: row.map_id,
      accountId: row.account_id,
      viewport: json.decode<MapPreferences['viewport']>(row.viewport),
      bookmarkTemplate: row.bookmark_template,
      updatedAt: Number(row.updated_at),
    };
  }

  async save(p: MapPreferences): Promise<void> {
    const values = {
      viewport: p.viewport ? json.encode(p.viewport) : null,
      bookmark_template: p.bookmarkTemplate,
      updated_at: p.updatedAt,
    };
    await this.db
      .insertInto('map_preferences')
      .values({ map_id: p.mapId, account_id: p.accountId, ...values })
      .onConflict((oc) => oc.columns(['map_id', 'account_id']).doUpdateSet(values))
      .execute();
  }
}
