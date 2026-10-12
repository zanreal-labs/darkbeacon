import type { Passage } from '../domain/map.js';

/** Ships recorded going through connections. Passages go with their connection. */
export interface PassageRepository {
  /** False when a passage from the same jump event exists already; nothing is inserted then. */
  insert(mapId: string, passage: Passage, eventId: string): Promise<boolean>;
  /** Passages of every connection on the map, oldest first. */
  listForMap(mapId: string): Promise<Passage[]>;
  /** Passages of one connection, newest first. */
  listForConnection(mapId: string, connectionId: string): Promise<Passage[]>;
}
