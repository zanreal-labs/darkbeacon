import { z } from 'zod';

/**
 * Where a wormhole type leads: a wormhole class (`c1`-`c6`), known space by security (`hs`, `ls`,
 * `ns`) or one of the special regions.
 */
export const WormholeDestination = z.enum([
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'hs',
  'ls',
  'ns',
  'thera',
  'c13',
  'pochven',
  'drifter',
]);
export type WormholeDestination = z.infer<typeof WormholeDestination>;

/** Short labels for a destination, as players write them ("D845 HS"). */
export const WORMHOLE_DESTINATION_LABEL: Record<WormholeDestination, string> = {
  c1: 'C1',
  c2: 'C2',
  c3: 'C3',
  c4: 'C4',
  c5: 'C5',
  c6: 'C6',
  hs: 'HS',
  ls: 'LS',
  ns: 'NS',
  thera: 'Thera',
  c13: 'C13',
  pochven: 'Pochven',
  drifter: 'Drifter',
};

/**
 * Destination of every wormhole type but K162 (the exit side, which leads back wherever the
 * other side is). From the game's wormhole type data as listed on
 * https://wiki.eveuniversity.org/Wormhole_Types; J377 leads to Turnur (low-sec) and X450 to
 * drone null-sec. Checked against the SDE's `wormholeTargetSystemClass` (Z006 leads to C3; I078,
 * L687, O546, O753 and R327 to Pochven; J492 to low-sec), see `packages/sde/data/wormholes.json`.
 */
export const WORMHOLE_TYPES: Readonly<Record<string, WormholeDestination>> = {
  A009: 'c13',
  A239: 'ls',
  A641: 'hs',
  A982: 'c6',
  B041: 'c6',
  B274: 'hs',
  B449: 'hs',
  B520: 'hs',
  B735: 'drifter',
  C008: 'c5',
  C125: 'c2',
  C140: 'ls',
  C247: 'c3',
  C248: 'ns',
  C391: 'ls',
  C414: 'drifter',
  C729: 'pochven',
  D364: 'c2',
  D382: 'c2',
  D792: 'hs',
  D845: 'hs',
  E004: 'c1',
  E175: 'c4',
  E545: 'ns',
  E587: 'ns',
  F135: 'thera',
  F216: 'pochven',
  F353: 'thera',
  G008: 'c6',
  G024: 'c2',
  H121: 'c1',
  H296: 'c5',
  H900: 'c5',
  I078: 'pochven',
  I182: 'c2',
  J244: 'ls',
  J377: 'ls',
  J492: 'ls',
  K329: 'ns',
  K346: 'ns',
  L005: 'c2',
  L031: 'thera',
  L477: 'c3',
  L614: 'c5',
  L687: 'pochven',
  M001: 'c4',
  M164: 'thera',
  M267: 'c3',
  M555: 'c5',
  M609: 'c4',
  N062: 'c5',
  N110: 'hs',
  N290: 'ls',
  N432: 'c5',
  N766: 'c2',
  N770: 'c5',
  N944: 'ls',
  N968: 'c3',
  O128: 'c4',
  O477: 'c3',
  O546: 'pochven',
  O753: 'pochven',
  O883: 'c3',
  P060: 'c1',
  Q003: 'ns',
  Q063: 'hs',
  Q317: 'c1',
  R051: 'ls',
  R081: 'c4',
  R259: 'drifter',
  R327: 'pochven',
  R474: 'c6',
  R943: 'c2',
  S047: 'hs',
  S199: 'ns',
  S804: 'c6',
  S877: 'drifter',
  T405: 'c4',
  T458: 'thera',
  U210: 'ls',
  U319: 'c6',
  U372: 'pochven',
  U574: 'c6',
  V283: 'ns',
  V301: 'c1',
  V753: 'c6',
  V898: 'ls',
  V911: 'c5',
  V928: 'drifter',
  W237: 'c6',
  X450: 'ns',
  X702: 'c3',
  X877: 'c4',
  Y683: 'c4',
  Y790: 'c1',
  Z006: 'c3',
  Z060: 'ns',
  Z142: 'ns',
  Z457: 'c4',
  Z647: 'c1',
  Z971: 'c1',
};

/** Where a wormhole type leads, or null for K162 and unknown types. Case-insensitive. */
export function wormholeDestination(type: string): WormholeDestination | null {
  return WORMHOLE_TYPES[type.trim().toUpperCase()] ?? null;
}

/** The six wormhole system effects (the secondary sun of a wormhole system). */
export const WormholeEffect = z.enum([
  'blackHole',
  'cataclysmicVariable',
  'magnetar',
  'pulsar',
  'redGiant',
  'wolfRayet',
]);
export type WormholeEffect = z.infer<typeof WormholeEffect>;

/**
 * What each effect changes, in a few words (shown as the effect's tooltip); see the system effects
 * section of https://wiki.eveuniversity.org/Wormhole_space.
 */
export const WORMHOLE_EFFECTS: Record<WormholeEffect, { name: string; summary: string }> = {
  blackHole: { name: 'Black Hole', summary: 'Faster ships and missiles, more inertia, weaker webs' },
  cataclysmicVariable: {
    name: 'Cataclysmic Variable',
    summary: 'Stronger remote repair, weaker local repair, slower capacitor recharge',
  },
  magnetar: { name: 'Magnetar', summary: 'More damage; worse tracking, targeting range and painters' },
  pulsar: {
    name: 'Pulsar',
    summary: 'More shields, faster capacitor, bigger signatures, lower armor resists',
  },
  redGiant: { name: 'Red Giant', summary: 'Stronger overheating, smartbombs and bombs; more heat damage' },
  wolfRayet: {
    name: 'Wolf-Rayet',
    summary: 'More armor and small weapon damage, smaller signatures, lower shield resists',
  },
};

/**
 * Where a SDE wormhole class id leads (`whClass` of a system, `targetClass` of a wormhole type):
 * 1-6 C1-C6, 7/8/9 high/low/null, 12 Thera, 13 shattered frigate holes, 14-18 Drifter systems,
 * 25 Pochven. Null for anything else (-1 marks region-bound types such as C729).
 */
export function destinationOfClass(whClass: number | null | undefined): WormholeDestination | null {
  switch (whClass) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return `c${whClass}` as WormholeDestination;
    case 7:
      return 'hs';
    case 8:
      return 'ls';
    case 9:
      return 'ns';
    case 12:
      return 'thera';
    case 13:
      return 'c13';
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
      return 'drifter';
    case 25:
      return 'pochven';
    default:
      return null;
  }
}

/** Hull classes for "which ships fit through"; supercarriers and titans never use wormholes. */
export const HullClass = z.enum([
  'frigate',
  'destroyer',
  'cruiser',
  'battlecruiser',
  'industrial',
  'battleship',
  'industrialCommand',
  'freighter',
  'capital',
]);
export type HullClass = z.infer<typeof HullClass>;

export const HULL_CLASS_LABEL: Record<HullClass, string> = {
  frigate: 'Frigates',
  destroyer: 'Destroyers',
  cruiser: 'Cruisers',
  battlecruiser: 'Battlecruisers',
  industrial: 'Industrials',
  battleship: 'Battleships',
  industrialCommand: 'Orca / Porpoise',
  freighter: 'Freighters',
  capital: 'Capitals',
};

/** A hull class with the mass of its heaviest published hull (kg), from the SDE. */
export const HullClassDto = z.object({
  id: HullClass,
  name: z.string(),
  maxMass: z.number(),
});
export type HullClassDto = z.infer<typeof HullClassDto>;

const WormholeShipSize = z.enum(['small', 'medium', 'large', 'xlarge']);

/**
 * A wormhole type with the attributes the SDE gives it. Masses in kg; the game varies a hole's
 * total mass by ±10 % around `totalMass`. K162 has no attributes of its own (it is the exit side of
 * another type), so its numbers are null.
 */
export const WormholeTypeDto = z.object({
  code: z.string(),
  /** Where it leads; null for K162 and region-bound types. */
  destination: WormholeDestination.nullable(),
  /** SDE wormhole class id of the destination (-1 for region-bound types). */
  targetClass: z.number().int().nullable(),
  /** Maximum lifetime in hours. */
  lifetimeHours: z.number().nullable(),
  totalMass: z.number().nullable(),
  maxJumpMass: z.number().nullable(),
  /** Mass regained per regeneration cycle; frigate holes regain all of it. */
  massRegeneration: z.number().nullable(),
  /** Hull classes whose heaviest hull fits through in one jump. */
  fits: z.array(HullClass),
  /** Connection size this type implies (see ShipSize); null when unknown. */
  shipSize: WormholeShipSize.nullable(),
});
export type WormholeTypeDto = z.infer<typeof WormholeTypeDto>;

/** GET /api/universe/wormholes: every wormhole type and the hull classes they are measured by. */
export const WormholeCatalogDto = z.object({
  types: z.array(WormholeTypeDto),
  hullClasses: z.array(HullClassDto),
});
export type WormholeCatalogDto = z.infer<typeof WormholeCatalogDto>;

/**
 * Connection size from a type's max jump mass: up to 5 000 t frigates and destroyers (small), up
 * to 62 000 t cruisers, battlecruisers and industrials (medium), up to 410 000 t battleships and
 * the Orca (large), above that freighters and capitals (xlarge).
 */
export function shipSizeForJumpMass(maxJumpMass: number | null): WormholeTypeDto['shipSize'] {
  if (maxJumpMass === null || maxJumpMass <= 0) return null;
  if (maxJumpMass <= 5_000_000) return 'small';
  if (maxJumpMass <= 62_000_000) return 'medium';
  if (maxJumpMass <= 410_000_000) return 'large';
  return 'xlarge';
}

/** The class of a solar system as players write it: C1-C6, HS/LS/NS, Thera, C13, Drifter, Pochven. */
export function classLabel(whClass: number | null | undefined): string | null {
  const destination = destinationOfClass(whClass);
  return destination ? WORMHOLE_DESTINATION_LABEL[destination] : null;
}
