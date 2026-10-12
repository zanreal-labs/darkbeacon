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

/** Static wormhole types and the effect of one wormhole system. */
export interface WormholeSystemFacts {
  statics?: string[];
  effect?: string | null;
}

/** A wormhole type (`D845`) with its dogma attributes from the SDE; null where it has none (K162). */
export interface WormholeTypeData {
  code: string;
  typeId: number;
  /** SDE wormhole class id of the destination (as `whClass`); -1 for region-bound types. */
  targetClass: number | null;
  /** Lifetime in minutes. */
  maxStableTimeMinutes: number | null;
  /** Total mass (kg) the wormhole lets through before it collapses (the game varies it by ±10 %). */
  maxStableMass: number | null;
  /** Heaviest single ship (kg) that may jump. */
  maxJumpMass: number | null;
  /** Mass (kg) it regains per regeneration cycle. */
  massRegeneration: number | null;
  targetDistribution: number | null;
}

/** A class of hulls and the mass range of its published ships (kg). */
export interface HullClassData {
  id:
    | 'frigate'
    | 'destroyer'
    | 'cruiser'
    | 'battlecruiser'
    | 'industrial'
    | 'battleship'
    | 'industrialCommand'
    | 'freighter'
    | 'capital';
  minMass: number;
  maxMass: number;
}

/**
 * Wormhole facts: wormhole types (SDE dogma), hull classes and ship masses (SDE), and per wormhole
 * system its static wormhole types (a statics table, see `docs/decisions.md`) and effect (SDE
 * secondary suns). Systems keyed by solar system id; systems that are not listed have neither.
 * `types`, `hullClasses` and `shipMasses` are optional so a hand-written file with only systems
 * still loads.
 */
export interface WormholeData {
  source: string;
  types?: WormholeTypeData[];
  hullClasses?: HullClassData[];
  /** Ship type id -> hull mass in kg. */
  shipMasses?: Record<string, number>;
  systems: Record<string, WormholeSystemFacts>;
}

export const WORMHOLE_DATA_FILE = fileURLToPath(new URL('../data/wormholes.json', import.meta.url));

export function loadWormholeData(file = WORMHOLE_DATA_FILE): WormholeData {
  return JSON.parse(readFileSync(file, 'utf8')) as WormholeData;
}

/**
 * Known space for the jump planner's map (`data/kspace.json`), columnar: index `i` of every
 * `systems` array describes one system. Coordinates are the SDE's in light years (y is "up"; the
 * top-down map draws x and z). `gates` lists stargates as index pairs `i, j` with `i < j`.
 */
export interface KspaceData {
  version: 1;
  source: string;
  regions: Array<{ id: number; name: string }>;
  systems: {
    id: number[];
    name: string[];
    /** Index into `regions`. */
    region: number[];
    /** True security status. */
    security: number[];
    x: number[];
    y: number[];
    z: number[];
    /** Bits of `KSPACE_FLAGS` (see kspace.ts). */
    flags: number[];
  };
  gates: number[];
  /** Published ships with a jump drive. */
  ships: JumpShipData[];
}

/** A ship with a jump drive, from its SDE type and dogma attributes. */
export interface JumpShipData {
  typeId: number;
  name: string;
  /** SDE inventory group (30 Titan, 902 Jump Freighter, ...). */
  group: number;
  /** Base jump range in light years, before Jump Drive Calibration. */
  rangeLy: number;
  /** Isotopes per light year, before skills. */
  fuelPerLy: number;
  isotope: 'helium' | 'hydrogen' | 'nitrogen' | 'oxygen';
  /** Share of the distance that counts for jump fatigue (1 for most hulls). */
  fatigueMultiplier: number;
  /** Hull mass in kg. */
  mass: number;
  /** Bridge fuel factor per kg bridged (titans and black ops), else null. */
  portalMassFactor: number | null;
}

export const KSPACE_DATA_FILE = fileURLToPath(new URL('../data/kspace.json', import.meta.url));

export function loadKspaceData(file = KSPACE_DATA_FILE): KspaceData {
  return JSON.parse(readFileSync(file, 'utf8')) as KspaceData;
}

export { KSPACE_FLAGS, METERS_PER_LY, ZARZAKH_ID } from './kspace.js';
