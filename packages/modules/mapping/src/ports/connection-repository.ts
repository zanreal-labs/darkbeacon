import type { Connection } from '../domain/map.js';

export interface ConnectionRepository {
  list(mapId: string): Promise<Connection[]>;
  findById(mapId: string, id: string): Promise<Connection | null>;
  /** The connection between two systems in either direction. */
  findBetween(mapId: string, a: number, b: number): Promise<Connection | null>;
  listForSystem(mapId: string, solarSystemId: number): Promise<Connection[]>;
  insert(connection: Connection): Promise<void>;
  update(connection: Connection): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
}
