/** One account's own character settings on one map. */
export interface MapCharacterSettings {
  mapId: string;
  accountId: string;
  /** Overrides the account's main character on this map. */
  mainCharacterId: number | null;
  /** The map follows this character's jumps. */
  followCharacterId: number | null;
  updatedAt: number;
}

export interface MapCharacterSettingsRepository {
  get(mapId: string, accountId: string): Promise<MapCharacterSettings | null>;
  save(settings: MapCharacterSettings): Promise<void>;
  forgetMap(mapId: string): Promise<void>;
}

/** What characters did on a map since a moment, read from the map's history (event log). */
export interface ActivityReader {
  /**
   * Per character: jumps (`character.jumped`), and systems, connections and signatures added
   * with the character as the actor's character.
   */
  activity(
    mapId: string,
    since: number,
  ): Promise<
    Array<{ characterId: number; jumps: number; systems: number; connections: number; signatures: number }>
  >;
}

/** ESI `/status`: whether Tranquility is up and open to players. */
export type ServerStatusReading =
  | { kind: 'up'; players: number; vip: boolean; serverVersion: string; startedAt: number | null }
  /** ESI answered that TQ cannot be reached (downtime). */
  | { kind: 'down' }
  /** ESI itself did not answer: say nothing about TQ. */
  | { kind: 'unknown' };

export interface ServerStatusSource {
  read(): Promise<ServerStatusReading>;
}
