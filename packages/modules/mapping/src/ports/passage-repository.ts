import type { Passage } from '../domain/map.js';

/** Ships recorded going through connections. Passages go with their connection. */
export interface PassageRepository {
  /**
   * False when a passage from the same jump event exists already; nothing is inserted then.
   * Passages logged by hand have no event (`eventId` null).
   */
  insert(mapId: string, passage: Passage, eventId: string | null): Promise<boolean>;
  findById(mapId: string, id: string): Promise<Passage | null>;
  update(mapId: string, passage: Passage): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
  /** Passages of every connection on the map, oldest first. */
  listForMap(mapId: string): Promise<Passage[]>;
  /** Passages of one connection, newest first. */
  listForConnection(mapId: string, connectionId: string): Promise<Passage[]>;
}

/** Names of EVE characters (pilots of tracked jumps), as far as this instance knows them. */
export interface PilotDirectory {
  names(characterIds: readonly number[]): Promise<Map<number, string>>;
}
