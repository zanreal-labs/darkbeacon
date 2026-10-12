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

/** Propulsion module sizes: 1MN AB / 5MN MWD, 10MN / 50MN, 100MN / 500MN, 10000MN / 50000MN. */
export type PropSizeData = 'small' | 'medium' | 'large' | 'capital';

/** A published ship (SDE): what "log a jump" and the rolling planner pick from. */
export interface ShipData {
  id: number;
  name: string;
  /** SDE inventory group name ("Battleship"). */
  group: string;
  /** Hull class for "which ships fit", null for groups outside them (capsules, shuttles...). */
  hull: HullClassData['id'] | null;
  /** The propulsion module size it fits (by rig size), null when it has no mid slots. */
  propSize: PropSizeData | null;
  /** It has rig slots, so a Higgs Anchor fits. */
  rigs: boolean;
  /** A Zero-Point Mass Entangler fits it. */
  entangler: boolean;
}

/**
 * What changes a ship's mass when it jumps, from SDE dogma: `massAddition` (796) of active
 * afterburners and microwarpdrives per size (every meta level of a size adds the same), and
 * `massBonusPercentage` (1131) of the Higgs Anchor rigs (+100) and the Zero-Point Mass Entangler (-80).
 */
export interface MassModifierData {
  prop: Record<PropSizeData, number>;
  higgsPercent: number;
  entanglerPercent: number;
}

/**
 * A fitted item that changes a ship's jump mass, by its name as fits (EFT) write it: armour plates
 * and prop modules add `add` kg (`massAddition`; a prop module only while it runs, `prop`),
 * subsystems add their own mass, Higgs Anchors and the mass entangler scale it by `percent`.
 */
export interface FitItemData {
  name: string;
  add?: number;
  percent?: number;
  prop?: true;
}

/**
 * Wormhole facts: wormhole types (SDE dogma), hull classes and ship masses (SDE), and per wormhole
 * system its static wormhole types (a statics table, see `docs/decisions.md`) and effect (SDE
 * secondary suns). Systems keyed by solar system id; systems that are not listed have neither.
 * `types`, `hullClasses`, `shipMasses`, `ships` and `massModifiers` are optional so a hand-written file with only systems
 * still loads.
 */
export interface WormholeData {
  source: string;
  types?: WormholeTypeData[];
  hullClasses?: HullClassData[];
  /** Ship type id -> hull mass in kg. */
  shipMasses?: Record<string, number>;
  /** Published ships by name, for pickers. */
  ships?: ShipData[];
  massModifiers?: MassModifierData;
  /** Items that change a fitted ship's mass, for pasted fits. */
  fitItems?: FitItemData[];
  systems: Record<string, WormholeSystemFacts>;
}

export const WORMHOLE_DATA_FILE = fileURLToPath(new URL('../data/wormholes.json', import.meta.url));

export function loadWormholeData(file = WORMHOLE_DATA_FILE): WormholeData {
  return JSON.parse(readFileSync(file, 'utf8')) as WormholeData;
}
