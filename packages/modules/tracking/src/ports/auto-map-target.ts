import type { MapScope } from '@wormwright/shared';

export interface RecordedJump {
  mapId: string;
  from: number;
  to: number;
  type: 'gate' | 'wormhole';
  characterId: number;
  shipTypeId: number | null;
  /** Owner of the character; the jump is recorded on their behalf. */
  accountId: string;
}

/** Provided by mapping: what auto-mapping reads from and writes to a map. */
export interface AutoMapTarget {
  /** Auto-mapping scopes of the map; null when the map does not exist (any more). */
  scopes(mapId: string): Promise<MapScope[] | null>;
  /**
   * Adds whichever of the two systems is missing (the new one placed next to the other) and a
   * connection of `type` between them unless one exists, emitting the mapping events.
   * Must be idempotent: several characters may report the same jump.
   */
  recordJump(jump: RecordedJump): Promise<void>;
}

/** Static universe data (the mapping module's UniverseCatalog satisfies it). */
export interface UniverseLookup {
  getSystem(solarSystemId: number): { whClass: number | null } | null;
  /** True when a stargate links the two systems. */
  gateLinked(a: number, b: number): boolean;
}
