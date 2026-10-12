/**
 * Security rules of known space. Sources: https://wiki.eveuniversity.org/System_security (display
 * rounding, high-sec 0.5-1.0) and https://wiki.eveuniversity.org/Security_status (faction police).
 */

/** True security from which a system is high-sec: 0.45 displays as 0.5. */
export const HIGH_SEC_MIN = 0.45;

/**
 * Security as the game shows it: rounded to one decimal, except that a true security between
 * 0.0 and 0.05 is rounded up to 0.1, so low-sec never shows 0.0.
 */
export function displaySecurity(trueSecurity: number): number {
  if (trueSecurity > 0 && trueSecurity < 0.05) return 0.1;
  return Math.round(trueSecurity * 10) / 10;
}

export function isHighSec(trueSecurity: number): boolean {
  return trueSecurity >= HIGH_SEC_MIN;
}

/**
 * Faction police attack a pilot in high-sec systems of a displayed security level when the
 * pilot's security status is at or below the level's threshold: -2.0 in 1.0 systems, -2.5 in 0.9,
 * -3.0 in 0.8, -3.5 in 0.7, -4.0 in 0.6 and -4.5 in 0.5. Low and null security have no police.
 */
export const FACTION_POLICE_THRESHOLDS: ReadonlyArray<{ level: number; atOrBelow: number }> = [
  { level: 1.0, atOrBelow: -2.0 },
  { level: 0.9, atOrBelow: -2.5 },
  { level: 0.8, atOrBelow: -3.0 },
  { level: 0.7, atOrBelow: -3.5 },
  { level: 0.6, atOrBelow: -4.0 },
  { level: 0.5, atOrBelow: -4.5 },
];

/** True when faction police attack a pilot of `securityStatus` in a system of `trueSecurity`. */
export function policeAttack(trueSecurity: number, securityStatus: number): boolean {
  if (!isHighSec(trueSecurity)) return false;
  const level = displaySecurity(trueSecurity);
  const rule = FACTION_POLICE_THRESHOLDS.find((r) => Math.abs(r.level - level) < 1e-9);
  return rule !== undefined && securityStatus <= rule.atOrBelow;
}

/**
 * The lowest displayed security level a pilot may enter without faction police, as the number of
 * levels closed to them (0 = all of high-sec is open, 6 = none of it). Routes for pilots with the
 * same number share their cached distances.
 */
export function closedLevels(securityStatus: number): number {
  return FACTION_POLICE_THRESHOLDS.filter((r) => securityStatus <= r.atOrBelow).length;
}
