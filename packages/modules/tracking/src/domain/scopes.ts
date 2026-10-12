import { DEFAULT_EXCLUDED_SYSTEMS, type MapScope } from '@darkbeacon/shared';

/** The map scope a system belongs to, from its SDE wormhole class; null when unknown. */
export function scopeOf(whClass: number | null | undefined): MapScope | null {
  switch (whClass) {
    case 7:
      return 'high';
    case 8:
      return 'low';
    case 9:
      return 'null';
    case 25:
      return 'pochven';
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 12: // Thera
    case 13: // shattered frigate holes
    case 14:
    case 15:
    case 16:
    case 17:
    case 18: // Drifter systems
      return 'wormhole';
    default:
      return null;
  }
}

/** How a map's auto-mapping decides which jumps to record. */
export interface AutoMapRules {
  scopes: readonly MapScope[];
  /** Systems never added by auto-mapping (Jita unless the map changed it). */
  excludedSystems: readonly number[];
  /**
   * `either`: a jump is mapped when either end is in scope (Darkbeacon's default: leaving the
   * chain shows the exit). `both`: as in Wanderer, a k-space jump needs both ends in scope,
   * while one wormhole end is still enough with the wormhole scope on.
   */
  gateRule: 'either' | 'both';
  /** A jump between the two ends of a known Ansiblex is recorded as a bridge, not a wormhole. */
  typeBridges: boolean;
}

export const DEFAULT_AUTO_MAP_RULES: Omit<AutoMapRules, 'scopes'> = {
  excludedSystems: DEFAULT_EXCLUDED_SYSTEMS,
  gateRule: 'either',
  typeBridges: true,
};

export interface JumpEnd {
  id: number;
  /** SDE wormhole class; null or undefined when the system is unknown (Abyssal, CCP). */
  whClass: number | null | undefined;
}

/**
 * Whether auto-mapping records a jump from `from` to `to`.
 *
 * - Systems the SDE does not know (Abyssal pockets, CCP systems) and excluded systems never are.
 * - With the wormhole scope on, a jump between two known-space systems that no stargate links
 *   went through a wormhole (high-sec to low-sec holes, Turnur, k-space K162s) and is mapped.
 * - Otherwise either end in scope is enough, or both ends under the `both` rule (where a
 *   wormhole end still suffices while the wormhole scope is on).
 */
export function jumpAllowed(
  rules: Pick<AutoMapRules, 'scopes' | 'excludedSystems' | 'gateRule'>,
  from: JumpEnd,
  to: JumpEnd,
  gate: boolean,
): boolean {
  if (from.id === to.id) return false;
  const a = scopeOf(from.whClass);
  const b = scopeOf(to.whClass);
  if (a === null || b === null) return false;
  if (rules.excludedSystems.includes(from.id) || rules.excludedSystems.includes(to.id)) return false;
  const wormholes = rules.scopes.includes('wormhole');
  const inScope = (s: MapScope) => rules.scopes.includes(s);
  if (wormholes && a !== 'wormhole' && b !== 'wormhole' && !gate) return true;
  if (rules.gateRule === 'both') {
    if (wormholes && (a === 'wormhole' || b === 'wormhole')) return true;
    return inScope(a) && inScope(b);
  }
  return inScope(a) || inScope(b);
}

/**
 * Auto-mapping records a jump when either end is in one of the map's scopes, so leaving the
 * chain into known space still shows the exit, while travel inside excluded space is ignored.
 * (The scope part of `jumpAllowed`, kept for callers that only know the classes.)
 */
export function jumpInScope(
  scopes: readonly MapScope[],
  fromClass: number | null | undefined,
  toClass: number | null | undefined,
): boolean {
  return [scopeOf(fromClass), scopeOf(toClass)].some((s) => s !== null && scopes.includes(s));
}
