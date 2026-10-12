import type { Database } from '@darkbeacon/db';
import type { HubRepository } from '@darkbeacon/routing';

export interface RoutingTables {
  routing_map_hubs: { map_id: string; solar_system_id: number; position: number };
  routing_personal_hubs: { account_id: string; solar_system_id: number; position: number };
}

export class KyselyHubRepository implements HubRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<RoutingTables>();
  }

  async mapHubs(mapId: string): Promise<number[]> {
    const rows = await this.db
      .selectFrom('routing_map_hubs')
      .select('solar_system_id')
      .where('map_id', '=', mapId)
      .orderBy('position')
      .execute();
    return rows.map((r) => Number(r.solar_system_id));
  }

  async setMapHubs(mapId: string, solarSystemIds: readonly number[]): Promise<void> {
    await this.database.transaction(async () => {
      await this.db.deleteFrom('routing_map_hubs').where('map_id', '=', mapId).execute();
      if (solarSystemIds.length === 0) return;
      await this.db
        .insertInto('routing_map_hubs')
        .values(solarSystemIds.map((id, position) => ({ map_id: mapId, solar_system_id: id, position })))
        .execute();
    });
  }

  async personalHubs(accountId: string): Promise<number[]> {
    const rows = await this.db
      .selectFrom('routing_personal_hubs')
      .select('solar_system_id')
      .where('account_id', '=', accountId)
      .orderBy('position')
      .execute();
    return rows.map((r) => Number(r.solar_system_id));
  }

  async setPersonalHubs(accountId: string, solarSystemIds: readonly number[]): Promise<void> {
    await this.database.transaction(async () => {
      await this.db.deleteFrom('routing_personal_hubs').where('account_id', '=', accountId).execute();
      if (solarSystemIds.length === 0) return;
      await this.db
        .insertInto('routing_personal_hubs')
        .values(
          solarSystemIds.map((id, position) => ({ account_id: accountId, solar_system_id: id, position })),
        )
        .execute();
    });
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('routing_map_hubs').where('map_id', '=', mapId).execute();
  }
}
