import type { MapPingDto } from '@darkbeacon/shared';

/** Rally pings of maps. They go with their map. */
export interface PingRepository {
  /** The map's pings, oldest first. */
  list(mapId: string): Promise<MapPingDto[]>;
  find(mapId: string, id: string): Promise<MapPingDto | null>;
  insert(ping: MapPingDto): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
}

/** The name and main character of the account behind a ping, as they are when it is called. */
export interface PingAuthorDirectory {
  account(accountId: string): Promise<{
    name: string;
    mainCharacterId: number | null;
    mainCharacterName: string | null;
  } | null>;
}
