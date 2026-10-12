import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Static universe data built from CCP's Static Data Export (SDE) by
 * `pnpm --filter @darkbeacon/sde universe`. The result is committed as `data/universe.json`.
 */
export interface SdeSolarSystem {
  id: number;
  name: string;
  regionId: number;
  constellationId: number;
  /** True security status, -1.0..1.0. */
  security: number;
  /** SDE wormhole class id (see UniverseSystemDto.whClass). */
  whClass: number | null;
  /** Stargate neighbours (solar system ids). */
  gates: number[];
}

export interface SdeRegion {
  id: number;
  name: string;
}

export interface SdeConstellation {
  id: number;
  name: string;
  regionId: number;
}

export interface UniverseData {
  /** SDE build the data was produced from. */
  source: string;
  regions: SdeRegion[];
  constellations: SdeConstellation[];
  systems: SdeSolarSystem[];
}

/** The committed dataset; `src/` and `dist/` both sit next to `data/`. */
export const UNIVERSE_DATA_FILE = fileURLToPath(new URL('../data/universe.json', import.meta.url));

export function loadUniverseData(file = UNIVERSE_DATA_FILE): UniverseData {
  return JSON.parse(readFileSync(file, 'utf8')) as UniverseData;
}

/**
 * Wormhole facts the SDE does not carry in a usable form: the static wormhole types of a system
 * and its effect. Keyed by solar system id; systems that are not listed have neither (as far as
 * the dataset knows).
 */
export interface WormholeData {
  source: string;
  systems: Record<string, { statics?: string[]; effect?: string | null }>;
}

export const WORMHOLE_DATA_FILE = fileURLToPath(new URL('../data/wormholes.json', import.meta.url));

export function loadWormholeData(file = WORMHOLE_DATA_FILE): WormholeData {
  return JSON.parse(readFileSync(file, 'utf8')) as WormholeData;
}
