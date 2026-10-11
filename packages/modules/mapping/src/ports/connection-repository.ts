import type { Connection } from '../domain/map.js';

export interface ConnectionRepository {
  list(mapId: string): Promise<Connection[]>;
  findById(mapId: string, id: string): Promise<Connection | null>;
  /** The connection between two systems in either direction. */
  findBetween(mapId: string, a: number, b: number): Promise<Connection | null>;
  listForSystem(mapId: string, solarSystemId: number): Promise<Connection[]>;
  /** False when the two systems are already connected (in either direction); nothing is inserted then. */
  insert(connection: Connection): Promise<boolean>;
  update(connection: Connection): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
}
