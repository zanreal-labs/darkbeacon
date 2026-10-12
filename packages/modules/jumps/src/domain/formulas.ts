/**
 * Range, fuel and fatigue of jump drives. Sources (checked 2026-10-12, see docs/decisions.md):
 * - SDE build 3586130 skills: Jump Drive Calibration `jumpDriveRangeBonus` 20 (% per level), Jump
 *   Fuel Conservation `consumptionQuantityBonusPercentage` -10; jump freighter traits "10 %
 *   reduction in jump fuel requirement" per level of Jump Freighters.
 * - https://wiki.eveuniversity.org/Jump_drives: fatigue "has a minimum value of 10 x (1 + (LY
 *   just traveled)) minutes", otherwise "the existing jump fatigue is multiplied by (1+(LY just
 *   traveled))", capped at 5 hours; the activation timer is at least 1 + LY minutes, otherwise a
 *   tenth of the fatigue before the jump, capped at 30 minutes; bridge fuel is
 *   "Mass×Portal Consumption Mass Factor×Base cost×Skill mod×Distance in LY".
 * - The March 2018 dev blog set the caps (5 hours fatigue, 30 minutes activation); the September
 *   2026 update (patch notes 24.01) left jump drives and fatigue as they were.
 */

/** Metres in one light year (IAU). */
export const METERS_PER_LY = 9_460_730_472_580_800;

export const RANGE_BONUS_PER_LEVEL = 0.2;
export const FUEL_BONUS_PER_LEVEL = 0.1;

export const FATIGUE_CAP_MINUTES = 300;
export const FATIGUE_FLOOR_MINUTES = 10;
export const ACTIVATION_CAP_MINUTES = 30;

/** Ansiblex jump bridges link systems at most 5 ly apart (wiki.eveuniversity.org/Ansiblex_Jump_Gate). */
export const ANSIBLEX_RANGE_LY = 5;

export interface JumpSkillLevels {
  /** Jump Drive Calibration. */
  jdc: number;
  /** Jump Fuel Conservation. */
  jfc: number;
  /** Jump Freighters. */
  jf: number;
}

const level = (n: number) => Math.max(0, Math.min(5, Math.trunc(n)));

/** Jump range in light years: +20 % per level of Jump Drive Calibration (twice the base at V). */
export function jumpRange(baseLy: number, jdc: number): number {
  return baseLy * (1 + RANGE_BONUS_PER_LEVEL * level(jdc));
}

/** Isotopes for one jump, rounded up to whole units. */
export function jumpFuel(
  fuelPerLy: number,
  ly: number,
  skills: Pick<JumpSkillLevels, 'jfc' | 'jf'>,
  jumpFreighterSkill: boolean,
): number {
  const conservation = 1 - FUEL_BONUS_PER_LEVEL * level(skills.jfc);
  const freighter = jumpFreighterSkill ? 1 - FUEL_BONUS_PER_LEVEL * level(skills.jf) : 1;
  return Math.ceil(roundOff(fuelPerLy * ly * conservation * freighter));
}

/** Isotopes a titan or black ops bridge costs for `massKg` over `ly`, rounded up. */
export function bridgeFuel(
  massKg: number,
  portalMassFactor: number,
  fuelPerLy: number,
  ly: number,
  jfc: number,
): number {
  return Math.ceil(
    roundOff(massKg * portalMassFactor * fuelPerLy * ly * (1 - FUEL_BONUS_PER_LEVEL * level(jfc))),
  );
}

/** Keeps float noise (8800 * 0.6 = 5279.999...) from rounding a whole number up. */
function roundOff(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export interface FatigueAfterJump {
  /** Minutes until the next jump may start. */
  activation: number;
  /** Fatigue after the jump (minutes). */
  fatigue: number;
}

/**
 * One jump of `effectiveLy` (the distance times the hull's fatigue multiplier) by a pilot with
 * `fatigueBefore` minutes of fatigue.
 */
export function fatigueAfterJump(fatigueBefore: number, effectiveLy: number): FatigueAfterJump {
  const before = Math.max(0, fatigueBefore);
  const activation = Math.min(ACTIVATION_CAP_MINUTES, Math.max(1 + effectiveLy, before / 10));
  const fatigue = Math.min(FATIGUE_CAP_MINUTES, Math.max(before, FATIGUE_FLOOR_MINUTES) * (1 + effectiveLy));
  return { activation, fatigue };
}

/**
 * How long to wait before a jump so that fatigue after it stays at or under `cap`; null when even
 * a pilot without fatigue would end above it (the floor alone is 10 x (1 + LY)).
 */
export function waitForFatigueCap(fatigueBefore: number, effectiveLy: number, cap: number): number | null {
  if (FATIGUE_FLOOR_MINUTES * (1 + effectiveLy) > cap + 1e-9) return null;
  return Math.max(0, fatigueBefore - cap / (1 + effectiveLy));
}

export function lightYears(meters: number): number {
  return meters / METERS_PER_LY;
}
