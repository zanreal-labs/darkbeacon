import { destinationOfClass } from './wormholes.js';

/**
 * `static`: a system's static; `wandering`: spawns at random; `reverse`: also seen as the exit
 * side of a wandering hole from another class.
 */
export type WormholeRespawn = 'static' | 'wandering' | 'reverse';

/**
 * Where each wormhole type spawns and how it respawns, as the game data lists it (see the type
 * tables of https://wiki.eveuniversity.org/Wormhole_Types). `spawnsIn` uses the words of
 * `WormholeDestination`, plus `c4-shattered`..`c6-shattered` (only shattered systems of that class)
 * and `jove` (Jove observatory systems). K162 is not listed: it is the exit side of every type.
 */
export const WORMHOLE_SPAWNS: Readonly<
  Record<string, { spawnsIn: readonly string[]; respawn: readonly WormholeRespawn[] }>
> = {
  A009: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'ns', 'thera', 'c13'], respawn: ['wandering'] },
  A239: { spawnsIn: ['c2'], respawn: ['static'] },
  A641: { spawnsIn: ['hs'], respawn: ['wandering'] },
  A982: { spawnsIn: ['c3', 'thera'], respawn: ['wandering'] },
  B041: { spawnsIn: ['hs'], respawn: ['wandering'] },
  B274: { spawnsIn: ['c2'], respawn: ['static'] },
  B449: { spawnsIn: ['ls', 'ns'], respawn: ['wandering'] },
  B520: { spawnsIn: ['c6'], respawn: ['wandering'] },
  B735: { spawnsIn: ['hs', 'ls', 'ns', 'jove'], respawn: ['wandering'] },
  C008: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  C125: { spawnsIn: ['c1'], respawn: ['wandering'] },
  C140: { spawnsIn: ['c5', 'c6'], respawn: ['wandering'] },
  C247: { spawnsIn: ['c4'], respawn: ['static'] },
  C248: { spawnsIn: ['c6'], respawn: ['wandering'] },
  C391: { spawnsIn: ['c6'], respawn: ['wandering'] },
  C414: { spawnsIn: ['hs', 'ls', 'ns', 'jove'], respawn: ['wandering'] },
  C729: { spawnsIn: ['pochven'], respawn: ['static'] },
  D364: { spawnsIn: ['c5'], respawn: ['static'] },
  D382: { spawnsIn: ['c2', 'drifter'], respawn: ['static', 'wandering'] },
  D792: { spawnsIn: ['c5', 'c6'], respawn: ['wandering'] },
  D845: { spawnsIn: ['c3', 'c4-shattered'], respawn: ['static'] },
  E004: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  E175: { spawnsIn: ['c5'], respawn: ['static', 'wandering'] },
  E545: { spawnsIn: ['c2'], respawn: ['static'] },
  E587: { spawnsIn: ['thera'], respawn: ['static'] },
  F135: { spawnsIn: ['c2', 'c3', 'c4', 'c5', 'c6'], respawn: ['wandering', 'reverse'] },
  F216: { spawnsIn: ['c2', 'c3', 'c4', 'c5', 'c6'], respawn: ['wandering', 'reverse'] },
  F353: { spawnsIn: ['c1'], respawn: ['wandering', 'reverse'] },
  G008: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  G024: { spawnsIn: ['c6'], respawn: ['static'] },
  H121: { spawnsIn: ['c1'], respawn: ['wandering'] },
  H296: { spawnsIn: ['c5'], respawn: ['static', 'wandering'] },
  H900: { spawnsIn: ['c4'], respawn: ['static', 'wandering'] },
  I078: { spawnsIn: ['pochven'], respawn: ['wandering'] },
  I182: { spawnsIn: ['c3', 'thera'], respawn: ['wandering'] },
  J244: { spawnsIn: ['c1'], respawn: ['static'] },
  J377: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'thera'], respawn: ['wandering', 'reverse'] },
  J492: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], respawn: ['wandering', 'reverse'] },
  K329: { spawnsIn: ['c4'], respawn: ['wandering'] },
  K346: { spawnsIn: ['c3', 'c4-shattered', 'c5-shattered', 'c6-shattered'], respawn: ['static'] },
  L005: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  L031: { spawnsIn: ['ns'], respawn: ['wandering', 'reverse'] },
  L477: { spawnsIn: ['c6'], respawn: ['static'] },
  L614: { spawnsIn: ['c1', 'ns'], respawn: ['wandering'] },
  L687: { spawnsIn: ['pochven'], respawn: ['wandering'] },
  M001: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  M164: { spawnsIn: ['ls'], respawn: ['wandering', 'reverse'] },
  M267: { spawnsIn: ['c5'], respawn: ['static'] },
  M555: { spawnsIn: ['hs'], respawn: ['wandering'] },
  M609: { spawnsIn: ['c1'], respawn: ['wandering'] },
  N062: { spawnsIn: ['c2', 'drifter'], respawn: ['static', 'wandering'] },
  N110: { spawnsIn: ['c1'], respawn: ['static'] },
  N290: { spawnsIn: ['c4'], respawn: ['wandering'] },
  N432: { spawnsIn: ['ls', 'ns'], respawn: ['wandering'] },
  N766: { spawnsIn: ['c4'], respawn: ['static'] },
  N770: { spawnsIn: ['c3', 'thera'], respawn: ['wandering'] },
  N944: { spawnsIn: ['ls', 'ns'], respawn: ['wandering'] },
  N968: { spawnsIn: ['c3', 'thera'], respawn: ['wandering'] },
  O128: { spawnsIn: ['hs', 'ls', 'ns'], respawn: ['wandering'] },
  O477: { spawnsIn: ['c2', 'drifter'], respawn: ['static', 'wandering'] },
  O546: { spawnsIn: ['pochven'], respawn: ['wandering'] },
  O883: { spawnsIn: ['c1', 'ns'], respawn: ['wandering'] },
  P060: { spawnsIn: ['c4'], respawn: ['static'] },
  Q003: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  Q063: { spawnsIn: ['thera'], respawn: ['static'] },
  Q317: { spawnsIn: ['c6'], respawn: ['static'] },
  R051: { spawnsIn: ['hs'], respawn: ['wandering'] },
  R081: { spawnsIn: ['pochven'], respawn: ['wandering'] },
  R259: { spawnsIn: ['hs', 'ls', 'ns', 'jove'], respawn: ['wandering'] },
  R474: { spawnsIn: ['c2', 'drifter'], respawn: ['static', 'wandering'] },
  R943: { spawnsIn: ['hs', 'ls', 'ns'], respawn: ['wandering'] },
  S047: { spawnsIn: ['c4'], respawn: ['wandering'] },
  S199: { spawnsIn: ['ls', 'ns'], respawn: ['wandering'] },
  S804: { spawnsIn: ['c1', 'ns'], respawn: ['wandering'] },
  S877: { spawnsIn: ['hs', 'ls', 'ns', 'jove'], respawn: ['wandering'] },
  T405: { spawnsIn: ['c3', 'thera'], respawn: ['wandering'] },
  T458: { spawnsIn: ['hs'], respawn: ['wandering', 'reverse'] },
  U210: { spawnsIn: ['c3', 'c4-shattered', 'c5-shattered'], respawn: ['static'] },
  U319: { spawnsIn: ['ls', 'ns'], respawn: ['wandering'] },
  U372: { spawnsIn: ['ns'], respawn: ['wandering', 'reverse'] },
  U574: { spawnsIn: ['c4'], respawn: ['static', 'wandering'] },
  V283: { spawnsIn: ['hs'], respawn: ['wandering'] },
  V301: { spawnsIn: ['c3', 'thera'], respawn: ['wandering'] },
  V753: { spawnsIn: ['c5'], respawn: ['static', 'wandering'] },
  V898: { spawnsIn: ['thera'], respawn: ['static'] },
  V911: { spawnsIn: ['c6'], respawn: ['static', 'wandering'] },
  V928: { spawnsIn: ['hs', 'ls', 'ns', 'jove'], respawn: ['wandering'] },
  W237: { spawnsIn: ['c6'], respawn: ['static', 'wandering'] },
  X450: { spawnsIn: ['pochven'], respawn: ['wandering'] },
  X702: { spawnsIn: ['hs', 'ls', 'ns'], respawn: ['wandering'] },
  X877: { spawnsIn: ['c4'], respawn: ['static', 'wandering'] },
  Y683: { spawnsIn: ['c2', 'drifter'], respawn: ['static', 'wandering'] },
  Y790: { spawnsIn: ['c5'], respawn: ['static'] },
  Z006: { spawnsIn: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'thera', 'c13'], respawn: ['wandering'] },
  Z060: { spawnsIn: ['c1'], respawn: ['static'] },
  Z142: { spawnsIn: ['c5', 'c6'], respawn: ['wandering'] },
  Z457: { spawnsIn: ['c6'], respawn: ['static', 'wandering'] },
  Z647: { spawnsIn: ['c2', 'drifter'], respawn: ['static', 'wandering'] },
  Z971: { spawnsIn: ['hs', 'ls', 'ns'], respawn: ['wandering'] },
};

/** Short labels of the `spawnsIn` words that are not destinations. */
export const SPAWN_AREA_LABEL: Readonly<Record<string, string>> = {
  'c4-shattered': 'C4 shattered',
  'c5-shattered': 'C5 shattered',
  'c6-shattered': 'C6 shattered',
  jove: 'Jove',
};

/**
 * Wormhole types that can be found in a system of SDE class `whClass`: its statics (every static
 * type of the class when they are not known), K162 (always possible), and the wandering types of
 * the class (shattered systems also get the shattered-only ones). Each list alphabetical, K162
 * last among the statics.
 */
export function wormholeTypesIn(
  whClass: number | null | undefined,
  statics: readonly string[],
  shattered = false,
): { statics: string[]; wandering: string[] } {
  const area = destinationOfClass(whClass);
  const fits = (spawnsIn: readonly string[]) =>
    !!area && (spawnsIn.includes(area) || (shattered && spawnsIn.includes(`${area}-shattered`)));
  const known = new Set(statics.map((s) => s.trim().toUpperCase()));
  const found = new Set<string>();
  const wandering: string[] = [];
  for (const [code, info] of Object.entries(WORMHOLE_SPAWNS)) {
    if (!fits(info.spawnsIn)) continue;
    if (info.respawn.includes('static') && (known.size === 0 || known.has(code))) found.add(code);
    if (info.respawn.includes('wandering')) wandering.push(code);
  }
  for (const code of known) found.add(code);
  return { statics: [...[...found].sort(), 'K162'], wandering: wandering.sort() };
}
