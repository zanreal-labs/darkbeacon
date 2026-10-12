import type { UniverseSystemDto } from '@darkbeacon/shared';

export type UniverseSystem = UniverseSystemDto;

/** Static game data (built from the SDE), loaded in memory. Synchronous on purpose. */
export interface UniverseCatalog {
  getSystem(solarSystemId: number): UniverseSystem | null;
  /** Case-insensitive prefix match first, then substring; at most `limit` results. */
  searchSystems(query: string, limit: number): UniverseSystem[];
  /** True when a stargate links the two systems. */
  gateLinked(a: number, b: number): boolean;
}
