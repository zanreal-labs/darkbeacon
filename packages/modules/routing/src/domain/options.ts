import type {
  Bubbled,
  MassStatus,
  RouteAvoidSpace,
  RouteSkip,
  ShipSize,
  TimeStatus,
} from '@darkbeacon/shared';
import type { BridgePilot } from './bridges.js';
import type { ExtraEdge } from './graph.js';
import { isWormholeSpace, type RouteNode, type RoutePolicy } from './modes.js';

/** What a route may use and must stay out of, besides its mode. */
export interface RouteOptions {
  /** Chain connections (and EVE-Scout holes) to leave out. */
  skip: readonly RouteSkip[];
  /** Systems never to pass through. */
  avoid: readonly number[];
  avoidSpace: readonly RouteAvoidSpace[];
  /** Thera and Turnur holes from EVE-Scout. */
  thera: boolean;
  /** Ansiblex jump bridges (imported lists and bridges drawn on the map). */
  bridges: boolean;
  /** Flying a capital: no jump bridge at all. */
  capital: boolean;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  skip: [],
  avoid: [],
  avoidSpace: [],
  thera: true,
  bridges: true,
  capital: false,
};

/** Options from a query, defaults for what it leaves out. */
export function routeOptions(query: {
  skip?: readonly RouteSkip[] | undefined;
  avoid?: readonly number[] | undefined;
  avoidSpace?: readonly RouteAvoidSpace[] | undefined;
  thera?: boolean | undefined;
  bridges?: boolean | undefined;
  capital?: boolean | undefined;
}): RouteOptions {
  return {
    skip: query.skip ?? [],
    avoid: query.avoid ?? [],
    avoidSpace: query.avoidSpace ?? [],
    thera: query.thera ?? true,
    bridges: query.bridges ?? true,
    capital: query.capital ?? false,
  };
}

/** The state of a link the options filter on (chain connections, EVE-Scout holes, bridges). */
export interface EdgeState {
  timeStatus: TimeStatus;
  massStatus: MassStatus;
  shipSize: ShipSize;
  dangerous: boolean;
  bubbled: Bubbled;
}

/** An extra edge with what route options look at. */
export interface RoutedEdge extends ExtraEdge {
  state: EdgeState;
  /** A jump bridge's owning alliance, when known (found through ESI); null or absent: not known. */
  ownerAllianceId?: number | null;
}

/**
 * Whether a route with these options may use an edge. `foreign` says a jump bridge belongs to
 * another alliance than the pilot's.
 */
export function usableEdge(edge: RoutedEdge, options: RouteOptions, foreign: (edge: RoutedEdge) => boolean) {
  const { state: s } = edge;
  const { skip } = options;
  const wormhole = edge.via === 'wormhole';
  if (wormhole && options.avoidSpace.includes('wormholes')) return false;
  if (edge.origin === 'eve-scout' && !options.thera) return false;
  if (edge.via === 'bridge') {
    if (!options.bridges || options.capital) return false;
    if (foreign(edge)) return false;
  }
  if (skip.includes('eol') && s.timeStatus === 'eol') return false;
  if (skip.includes('critical') && s.massStatus === 'critical') return false;
  if (skip.includes('frigate') && s.shipSize === 'small') return false;
  if (skip.includes('medium') && s.shipSize === 'medium') return false;
  if (skip.includes('dangerous') && s.dangerous) return false;
  if (skip.includes('bubbled') && s.bubbled !== 'none') return false;
  return true;
}

/** Equal keys filter edges alike (the pilot's alliance decides which bridges they may take). */
export function edgeKey(options: RouteOptions, pilot: BridgePilot): string {
  const who = pilot === null ? '' : `:${pilot.allianceId ?? 'none'}`;
  return [
    [...options.skip].sort().join(','),
    options.avoidSpace.includes('wormholes') ? 'w' : '',
    options.thera ? 't' : '',
    options.bridges && !options.capital ? `b${who}` : '',
  ].join('|');
}

/** The mode's policy, also keeping out of the avoided systems and kinds of space. */
export function withAvoidance(
  policy: RoutePolicy,
  options: Pick<RouteOptions, 'avoid' | 'avoidSpace'>,
): RoutePolicy {
  const space = new Set(options.avoidSpace);
  const avoid = new Set(options.avoid);
  if (space.size === 0 && avoid.size === 0) return policy;
  const kept = (node: RouteNode) => {
    if (avoid.has(node.id)) return false;
    if (space.has('wormholes') && isWormholeSpace(node)) return false;
    if (space.has('pochven') && (node.whClass === 25 || node.invasion === 'final')) return false;
    if (space.has('edencom') && node.invasion === 'edencom') return false;
    if (space.has('triglavian') && node.invasion === 'triglavian') return false;
    return true;
  };
  return {
    key: `${policy.key}|${[...space].sort().join(',')}|${[...avoid].sort((a, b) => a - b).join(',')}`,
    mode: policy.mode,
    allows: (node) => policy.allows(node) && kept(node),
    cost: policy.cost,
  };
}
