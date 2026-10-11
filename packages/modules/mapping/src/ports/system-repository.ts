import type { MapSystem } from '../domain/map.js';

export interface SystemRepository {
  list(mapId: string): Promise<MapSystem[]>;
  find(mapId: string, solarSystemId: number): Promise<MapSystem | null>;
  insert(system: MapSystem): Promise<void>;
  update(system: MapSystem): Promise<void>;
  delete(mapId: string, solarSystemId: number): Promise<void>;
}
