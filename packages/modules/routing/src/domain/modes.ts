import type { RouteMode } from '@darkbeacon/shared';
import { displaySecurity, FACTION_POLICE_THRESHOLDS, isHighSec } from './security.js';

/** What the route engine knows about a system. */
export interface RouteNode {
  id: number;
  security: number;
  /** SDE wormhole class id (see UniverseSystemDto). */
  whClass: number | null;
}

/** Wormhole space: C1-C6, Thera, shattered frigate systems and the Drifter systems. */
export function isWormholeSpace(node: Pick<RouteNode, 'whClass'>): boolean {
  const c = node.whClass;
  return c !== null && ((c >= 1 && c <= 6) || (c >= 12 && c <= 18));
}

/** Known-space high-sec (wormhole space has -1.0 and never counts). */
export function isHighSecSpace(node: RouteNode): boolean {
  return !isWormholeSpace(node) && isHighSec(node.security);
}

/** Extra cost of entering a system the `safer` mode would rather avoid. */
export const SAFER_PENALTY = 50;

/**
 * How a mode treats a system on the way: whether it may be entered at all (the start never needs
 * to be) and what entering it costs. Costs are integers >= 1, so the cheapest route is also the
 * shortest one whenever no penalty applies.
 */
export interface RoutePolicy {
  /** Cache key: equal keys route the same way. */
  key: string;
  mode: RouteMode;
  allows(node: RouteNode): boolean;
  cost(node: RouteNode): number;
}

/**
 * The policy of a mode. `pilot` needs `closed`, the number of high-sec levels whose faction police
 * attack the pilot (see `closedLevels`).
 */
export function policyFor(mode: RouteMode, closed = 0): RoutePolicy {
  switch (mode) {
    case 'shortest':
      return { key: mode, mode, allows: () => true, cost: () => 1 };
    case 'safer':
      return {
        key: mode,
        mode,
        allows: () => true,
        cost: (node) => (isHighSecSpace(node) ? 1 : 1 + SAFER_PENALTY),
      };
    case 'highsec':
      // Known space only in high-sec; the chain's wormhole systems stay usable to get out.
      return {
        key: mode,
        mode,
        allows: (node) => isWormholeSpace(node) || isHighSecSpace(node),
        cost: () => 1,
      };
    case 'outlaw':
      return { key: mode, mode, allows: (node) => !isHighSecSpace(node), cost: () => 1 };
    case 'pilot': {
      const levels = FACTION_POLICE_THRESHOLDS.slice(0, Math.max(0, Math.min(closed, 6))).map((r) => r.level);
      const forbidden = (node: RouteNode) =>
        isHighSecSpace(node) &&
        levels.some((level) => Math.abs(level - displaySecurity(node.security)) < 1e-9);
      return { key: `pilot:${levels.length}`, mode, allows: (node) => !forbidden(node), cost: () => 1 };
    }
  }
}
