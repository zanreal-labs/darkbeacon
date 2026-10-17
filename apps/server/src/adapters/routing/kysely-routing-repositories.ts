import { bool, json, type Database } from '@darkbeacon/db';
import type {
  BridgeRecord,
  BridgeRepository,
  NewBridge,
  RoutingSettingsRepository,
} from '@darkbeacon/routing';
import type { MapRoutingSettingsDto, RoutePreferencesDto } from '@darkbeacon/shared';

interface BridgeRow {
  id: string;
  map_id: string;
  a: number;
  b: number;
  dangerous: number;
  source: string;
  structure_id: number | null;
  structure_name: string | null;
  owner_corporation_id: number | null;
  owner_alliance_id: number | null;
  created_at: number;
}

export interface RoutingSettingsTables {
  routing_bridges: BridgeRow;
  routing_preferences: { account_id: string; settings: string; updated_at: number };
  routing_map_settings: { map_id: string; settings: string; updated_at: number };
}

const toRecord = (r: BridgeRow): BridgeRecord => ({
  id: r.id,
  mapId: r.map_id,
  a: Number(r.a),
  b: Number(r.b),
  dangerous: bool.decode(r.dangerous),
  source: r.source === 'esi' ? 'esi' : 'paste',
  structureId: r.structure_id === null ? null : Number(r.structure_id),
  structureName: r.structure_name,
  ownerCorporationId: r.owner_corporation_id === null ? null : Number(r.owner_corporation_id),
  ownerAllianceId: r.owner_alliance_id === null ? null : Number(r.owner_alliance_id),
  createdAt: Number(r.created_at),
});

export class KyselyBridgeRepository implements BridgeRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<RoutingSettingsTables>();
  }

  async list(mapId: string): Promise<BridgeRecord[]> {
    const rows = await this.db
      .selectFrom('routing_bridges')
      .selectAll()
      .where('map_id', '=', mapId)
      .execute();
    return rows.map(toRecord);
  }

  async find(mapId: string, id: string): Promise<BridgeRecord | null> {
    const row = await this.db
      .selectFrom('routing_bridges')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async upsert(
    bridges: readonly NewBridge[],
    options: { id(): string; now: number; keepDangerous: boolean },
  ): Promise<{ added: BridgeRecord[]; updated: BridgeRecord[]; known: number }> {
    const added: BridgeRecord[] = [];
    const updated: BridgeRecord[] = [];
    let known = 0;
    const seen = new Set<string>();
    await this.database.transaction(async () => {
      for (const bridge of bridges) {
        const key = `${bridge.mapId}:${bridge.a}:${bridge.b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = await this.db
          .selectFrom('routing_bridges')
          .selectAll()
          .where('map_id', '=', bridge.mapId)
          .where('a', '=', bridge.a)
          .where('b', '=', bridge.b)
          .executeTakeFirst();
        if (!existing) {
          const row: BridgeRow = {
            id: options.id(),
            map_id: bridge.mapId,
            a: bridge.a,
            b: bridge.b,
            dangerous: bool.encode(bridge.dangerous),
            source: bridge.source,
            structure_id: bridge.structureId,
            structure_name: bridge.structureName,
            owner_corporation_id: bridge.ownerCorporationId,
            owner_alliance_id: bridge.ownerAllianceId,
            created_at: options.now,
          };
          await this.db.insertInto('routing_bridges').values(row).execute();
          added.push(toRecord(row));
          continue;
        }
        known++;
        const before = toRecord(existing);
        const dangerous = options.keepDangerous ? before.dangerous || bridge.dangerous : bridge.dangerous;
        const structureId = bridge.structureId ?? before.structureId;
        const structureName = bridge.structureName ?? before.structureName;
        // Found through ESI, a pasted pair learns its owner; a paste never forgets one.
        const owned = bridge.ownerCorporationId !== null || bridge.ownerAllianceId !== null;
        const ownerCorporationId = owned ? bridge.ownerCorporationId : before.ownerCorporationId;
        const ownerAllianceId = owned ? bridge.ownerAllianceId : before.ownerAllianceId;
        if (
          dangerous === before.dangerous &&
          structureId === before.structureId &&
          structureName === before.structureName &&
          ownerCorporationId === before.ownerCorporationId &&
          ownerAllianceId === before.ownerAllianceId
        )
          continue;
        await this.db
          .updateTable('routing_bridges')
          .set({
            dangerous: bool.encode(dangerous),
            structure_id: structureId,
            structure_name: structureName,
            owner_corporation_id: ownerCorporationId,
            owner_alliance_id: ownerAllianceId,
          })
          .where('id', '=', before.id)
          .execute();
        updated.push({
          ...before,
          dangerous,
          structureId,
          structureName,
          ownerCorporationId,
          ownerAllianceId,
        });
      }
    });
    return { added, updated, known };
  }

  async setDangerous(mapId: string, id: string, dangerous: boolean): Promise<BridgeRecord | null> {
    await this.db
      .updateTable('routing_bridges')
      .set({ dangerous: bool.encode(dangerous) })
      .where('map_id', '=', mapId)
      .where('id', '=', id)
      .execute();
    return this.find(mapId, id);
  }

  async remove(mapId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.deleteFrom('routing_bridges').where('map_id', '=', mapId).where('id', 'in', ids).execute();
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('routing_bridges').where('map_id', '=', mapId).execute();
  }
}

export class KyselyRoutingSettingsRepository implements RoutingSettingsRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<RoutingSettingsTables>();
  }

  async preferences(accountId: string): Promise<RoutePreferencesDto | null> {
    const row = await this.db
      .selectFrom('routing_preferences')
      .select('settings')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return json.decode<RoutePreferencesDto>(row?.settings);
  }

  async setPreferences(accountId: string, preferences: RoutePreferencesDto, now: number): Promise<void> {
    const settings = json.encode(preferences);
    await this.db
      .insertInto('routing_preferences')
      .values({ account_id: accountId, settings, updated_at: now })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ settings, updated_at: now }))
      .execute();
  }

  async mapSettings(mapId: string): Promise<MapRoutingSettingsDto | null> {
    const row = await this.db
      .selectFrom('routing_map_settings')
      .select('settings')
      .where('map_id', '=', mapId)
      .executeTakeFirst();
    return json.decode<MapRoutingSettingsDto>(row?.settings);
  }

  async setMapSettings(mapId: string, value: MapRoutingSettingsDto, now: number): Promise<void> {
    const settings = json.encode(value);
    await this.db
      .insertInto('routing_map_settings')
      .values({ map_id: mapId, settings, updated_at: now })
      .onConflict((oc) => oc.column('map_id').doUpdateSet({ settings, updated_at: now }))
      .execute();
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('routing_map_settings').where('map_id', '=', mapId).execute();
  }
}
