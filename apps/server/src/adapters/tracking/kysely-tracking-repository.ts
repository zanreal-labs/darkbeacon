import { bool, type Database } from '@wormwright/db';
import type { CharacterPresence, TrackedCharacter, TrackingRepository } from '@wormwright/tracking';

export interface TrackingTables {
  tracked_character: { map_id: string; character_id: number; account_id: string; since: number };
  character_presence: {
    character_id: number;
    account_id: string;
    name: string;
    solar_system_id: number | null;
    ship_type_id: number | null;
    ship_name: string | null;
    online: number;
    updated_at: number;
  };
}

type TrackedRow = TrackingTables['tracked_character'];
type PresenceRow = TrackingTables['character_presence'];

export class KyselyTrackingRepository implements TrackingRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<TrackingTables>();
  }

  async listTracked(): Promise<TrackedCharacter[]> {
    const rows = await this.db.selectFrom('tracked_character').selectAll().orderBy('since').execute();
    return rows.map(toTracked);
  }

  async listTrackedOnMap(mapId: string): Promise<TrackedCharacter[]> {
    const rows = await this.db
      .selectFrom('tracked_character')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('since')
      .execute();
    return rows.map(toTracked);
  }

  async setTracked(entry: TrackedCharacter, tracked: boolean): Promise<void> {
    if (!tracked) {
      await this.db
        .deleteFrom('tracked_character')
        .where('map_id', '=', entry.mapId)
        .where('character_id', '=', entry.characterId)
        .execute();
      return;
    }
    await this.db
      .insertInto('tracked_character')
      .values({
        map_id: entry.mapId,
        character_id: entry.characterId,
        account_id: entry.accountId,
        since: entry.since,
      })
      .onConflict((oc) => oc.columns(['map_id', 'character_id']).doNothing())
      .execute();
  }

  async untrackMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('tracked_character').where('map_id', '=', mapId).execute();
  }

  async getPresence(characterId: number): Promise<CharacterPresence | null> {
    const row = await this.db
      .selectFrom('character_presence')
      .selectAll()
      .where('character_id', '=', characterId)
      .executeTakeFirst();
    return row ? toPresence(row) : null;
  }

  async listPresence(characterIds: readonly number[]): Promise<CharacterPresence[]> {
    if (characterIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('character_presence')
      .selectAll()
      .where('character_id', 'in', [...characterIds])
      .execute();
    return rows.map(toPresence);
  }

  async savePresence(p: CharacterPresence): Promise<void> {
    const row: PresenceRow = {
      character_id: p.characterId,
      account_id: p.accountId,
      name: p.name,
      solar_system_id: p.solarSystemId,
      ship_type_id: p.shipTypeId,
      ship_name: p.shipName,
      online: bool.encode(p.online),
      updated_at: p.updatedAt,
    };
    const { character_id: _, ...changes } = row;
    await this.db
      .insertInto('character_presence')
      .values(row)
      .onConflict((oc) => oc.column('character_id').doUpdateSet(changes))
      .execute();
  }
}

function toTracked(row: TrackedRow): TrackedCharacter {
  return {
    mapId: row.map_id,
    characterId: Number(row.character_id),
    accountId: row.account_id,
    since: Number(row.since),
  };
}

function toPresence(row: PresenceRow): CharacterPresence {
  const id = (value: number | null) => (value === null ? null : Number(value));
  return {
    characterId: Number(row.character_id),
    accountId: row.account_id,
    name: row.name,
    solarSystemId: id(row.solar_system_id),
    shipTypeId: id(row.ship_type_id),
    shipName: row.ship_name,
    online: bool.decode(row.online),
    updatedAt: Number(row.updated_at),
  };
}
