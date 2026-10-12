import type { CynoKind, JumpHull } from '@darkbeacon/shared';

/**
 * What a hull may do on a jump route. Sources (checked 2026-10-12, see docs/decisions.md):
 * - SDE build 3586130: which cynosural fields each hull jumps to (`jumpDriveTargetBeaconTypelistID`:
 *   341 capitals: normal cynos; 343/348 jump freighters and Rorqual: normal and industrial; 342
 *   black ops: normal, covert and industrial).
 * - https://wiki.eveuniversity.org/Capital_ships: "True capitals can only operate outside of
 *   high-sec space"; freighters and jump freighters "can enter high-sec"; the Rorqual is a true
 *   capital; capitals "can use stargates to travel (except to high-sec)".
 * - https://wiki.eveuniversity.org/Jump_Freighters: they "can jump out of highsec space".
 * - Patch notes 24.01 (2026-09-22.1): "Removed the ability for capitals to use an Ansiblex Jump
 *   Bridge. Rorquals, Freighters, and Jump Freighters can still use Ansiblex Jump Bridges."
 * - https://wiki.eveuniversity.org/Ansiblex_Jump_Gate: supercapitals never could.
 */
export interface HullRules {
  /** May be in high-sec: take its gates and jump out of it. */
  highSec: boolean;
  /** A capital as gate rules see it (no stargates in Pochven, none into Zarzakh). */
  capital: boolean;
  ansiblex: boolean;
  /** The cyno to light for it: the cheapest kind it can jump to. */
  cyno: CynoKind;
  /** Jump Freighters skill cuts its fuel (10 % per level). */
  jumpFreighterSkill: boolean;
  /** Opens bridges for other ships (titan Jump Portal Generator, black ops Covert Jump Portal). */
  bridges: boolean;
}

const capital = (cyno: CynoKind = 'regular'): HullRules => ({
  highSec: false,
  capital: true,
  ansiblex: false,
  cyno,
  jumpFreighterSkill: false,
  bridges: false,
});

export const HULL_RULES: Readonly<Record<JumpHull, HullRules>> = {
  jump_freighter: {
    highSec: true,
    capital: true,
    ansiblex: true,
    cyno: 'industrial',
    jumpFreighterSkill: true,
    bridges: false,
  },
  black_ops: {
    highSec: true,
    capital: false,
    ansiblex: true,
    cyno: 'covert',
    jumpFreighterSkill: false,
    bridges: true,
  },
  rorqual: { ...capital('industrial'), ansiblex: true },
  carrier: capital(),
  command_carrier: capital(),
  dreadnought: capital(),
  lancer: capital(),
  force_auxiliary: capital(),
  supercarrier: capital(),
  titan: { ...capital(), bridges: true },
};

/** SDE inventory groups of ships with a jump drive. */
export const HULL_GROUPS: Readonly<Record<number, JumpHull>> = {
  30: 'titan',
  659: 'supercarrier',
  547: 'carrier',
  5120: 'command_carrier',
  485: 'dreadnought',
  4594: 'lancer',
  1538: 'force_auxiliary',
  883: 'rorqual',
  902: 'jump_freighter',
  898: 'black_ops',
};

export function hullOfGroup(group: number): JumpHull | null {
  return HULL_GROUPS[group] ?? null;
}
