import { bool, type Database } from '@darkbeacon/db';
import { TrackingProblemKind } from '@darkbeacon/shared';
import type {
  CharacterPresence,
  MapCharacterSettings,
  MapCharacterSettingsRepository,
  TrackedCharacter,
  TrackingProblem,
  TrackingProblemStore,
  TrackingRepository,
} from '@darkbeacon/tracking';

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
    docked: number | null;
  };
  tracking_problem: { character_id: number; kind: string; message: string; since: number };
  map_character_setting: {
    map_id: string;
    account_id: string;
    main_character_id: number | null;
    follow_character_id: number | null;
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

  async findTracked(mapId: string, characterId: number): Promise<TrackedCharacter | null> {
    const row = await this.db
      .selectFrom('tracked_character')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('character_id', '=', characterId)
      .executeTakeFirst();
    return row ? toTracked(row) : null;
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
      docked: p.docked === undefined ? null : bool.encode(p.docked),
    };
    const { character_id: _, ...changes } = row;
    await this.db
      .insertInto('character_presence')
      .values(row)
      .onConflict((oc) => oc.column('character_id').doUpdateSet(changes))
      .execute();
  }

  async deletePresence(characterId: number): Promise<void> {
    await this.db.deleteFrom('character_presence').where('character_id', '=', characterId).execute();
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
    ...(row.docked === null || row.docked === undefined ? {} : { docked: bool.decode(row.docked) }),
  };
}

/** Why tracking cannot read a character's location, while it cannot. */
export class KyselyTrackingProblems implements TrackingProblemStore {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<TrackingTables>();
  }

  async set(problem: TrackingProblem): Promise<void> {
    const changes = { kind: problem.kind, message: problem.message, since: problem.since };
    await this.db
      .insertInto('tracking_problem')
      .values({ character_id: problem.characterId, ...changes })
      .onConflict((oc) => oc.column('character_id').doUpdateSet(changes))
      .execute();
  }

  async clear(characterId: number): Promise<void> {
    await this.db.deleteFrom('tracking_problem').where('character_id', '=', characterId).execute();
  }

  async list(characterIds: readonly number[]): Promise<TrackingProblem[]> {
    if (characterIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('tracking_problem')
      .selectAll()
      .where('character_id', 'in', [...characterIds])
      .execute();
    return rows.map((row) => ({
      characterId: Number(row.character_id),
      // A kind written by a later version reads as the generic one.
      kind: TrackingProblemKind.catch('unavailable').parse(row.kind),
      message: row.message,
      since: Number(row.since),
    }));
  }
}

/** Each account's main and followed character per map. */
export class KyselyMapCharacterSettings implements MapCharacterSettingsRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<TrackingTables>();
  }

  async get(mapId: string, accountId: string): Promise<MapCharacterSettings | null> {
    const row = await this.db
      .selectFrom('map_character_setting')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!row) return null;
    const id = (v: number | null) => (v === null ? null : Number(v));
    return {
      mapId,
      accountId,
      mainCharacterId: id(row.main_character_id),
      followCharacterId: id(row.follow_character_id),
      updatedAt: Number(row.updated_at),
    };
  }

  async save(settings: MapCharacterSettings): Promise<void> {
    const changes = {
      main_character_id: settings.mainCharacterId,
      follow_character_id: settings.followCharacterId,
      updated_at: settings.updatedAt,
    };
    await this.db
      .insertInto('map_character_setting')
      .values({ map_id: settings.mapId, account_id: settings.accountId, ...changes })
      .onConflict((oc) => oc.columns(['map_id', 'account_id']).doUpdateSet(changes))
      .execute();
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('map_character_setting').where('map_id', '=', mapId).execute();
  }
}
