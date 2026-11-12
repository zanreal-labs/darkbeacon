import type { MapSystem } from '../domain/map.js';

export interface SystemRepository {
  /** Every system on the map, hidden ones included. */
  list(mapId: string): Promise<MapSystem[]>;
  find(mapId: string, solarSystemId: number): Promise<MapSystem | null>;
  insert(system: MapSystem): Promise<void>;
  /** `written`: fields that count as changed now even when their value stays (see `UpdateOptions`). */
  update(system: MapSystem, options?: { written?: readonly string[] }): Promise<void>;
  delete(mapId: string, solarSystemId: number): Promise<void>;
  /** Visible systems per map (the admins' inventory). */
  countVisibleByMap(): Promise<Map<string, number>>;
  /** Systems someone put where they are (dragged), which the map never moves by itself. */
  byHand(mapId: string): Promise<Set<number>>;
  /** Marks systems as put there by hand, or as placed by the map's rule again. */
  setByHand(mapId: string, solarSystemIds: readonly number[], byHand: boolean): Promise<void>;
}
