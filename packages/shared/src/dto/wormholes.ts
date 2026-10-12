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
 * drone null-sec. Z006 is left out because its listed destination is ambiguous.
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
  I182: 'c2',
  J244: 'ls',
  J377: 'ls',
  K329: 'ns',
  K346: 'ns',
  L005: 'c2',
  L031: 'thera',
  L477: 'c3',
  L614: 'c5',
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
  O883: 'c3',
  P060: 'c1',
  Q003: 'ns',
  Q063: 'hs',
  Q317: 'c1',
  R051: 'ls',
  R081: 'c4',
  R259: 'drifter',
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
