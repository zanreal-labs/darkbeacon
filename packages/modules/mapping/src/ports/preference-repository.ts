import type { MapPreferences } from '../domain/map.js';

/** One account's own view of a map (viewport, bookmark template). */
export interface MapPreferenceRepository {
  find(mapId: string, accountId: string): Promise<MapPreferences | null>;
  /** Inserts or replaces the row of (mapId, accountId). */
  save(preferences: MapPreferences): Promise<void>;
}
