import type {
  MapExitDto,
  RouteSpace,
  SystemStatus,
  UniverseSystemDto,
  WormholeDestination,
} from '@darkbeacon/shared';
import type { TokenName } from '@darkbeacon/theme-sdk';

export const STATUS_LABEL: Record<SystemStatus, string> = {
  unknown: 'Unknown',
  home: 'Home',
  friendly: 'Friendly',
  empty: 'Empty',
  occupied: 'Occupied',
  warning: 'Warning',
  hostile: 'Hostile',
  target: 'Target',
};

/** What each status tells the fleet, one line each, for the status list. */
export const STATUS_MEANING: Record<SystemStatus, string> = {
  unknown: 'Nobody has looked yet.',
  home: 'Where we live.',
  friendly: 'Friends live here.',
  empty: 'Scouted: nobody lives here.',
  occupied: 'Someone lives here, not known to be hostile.',
  warning: 'Careful: something was seen here.',
  hostile: 'Hostiles live or roam here.',
  target: 'We are going after someone here.',
};

/**
 * The node border of each status: grey by default (unknown, empty), coloured where it means
 * something. One token each, so themes recolour them.
 */
export const STATUS_BORDER: Record<SystemStatus, TokenName> = {
  unknown: 'node-border',
  home: 'status-home',
  friendly: 'status-friendly',
  empty: 'node-border',
  occupied: 'status-occupied',
  warning: 'status-warning',
  hostile: 'status-hostile',
  target: 'status-target',
};

/**
 * Security colours exactly as the game client draws them, 1.0 down to 0.0 (negative systems take
 * the 0.0 red), as recorded from the client in https://web.archive.org/web/20120219150840/http://blog.evepanel.net/eve-online/igb/colors-of-the-security-status.html.
 * The same in every theme; the pill's dark text stays readable on all of them.
 */
export const SECURITY_COLORS: Readonly<Record<string, string>> = {
  '1.0': '#2fefef',
  '0.9': '#48f0c0',
  '0.8': '#00ef47',
  '0.7': '#00f000',
  '0.6': '#8fef2f',
  '0.5': '#efef00',
  '0.4': '#d77700',
  '0.3': '#f06000',
  '0.2': '#f04800',
  '0.1': '#d73000',
  '0.0': '#f00000',
};

/** Security as the game shows it: one decimal, 0.0 < s < 0.05 rounded up to 0.1. */
export function shownSecurity(security: number): number {
  if (security > 0 && security < 0.05) return 0.1;
  return Math.round(security * 10) / 10;
}

export type ClassPill =
  | { kind: 'security'; label: string; background: string }
  | { kind: 'class'; label: string; token: 'pill-wormhole' | 'pill-special' }
  | { kind: 'unknown'; label: string };

/**
 * The designation pill: wormhole classes and special space filled with their colour, known space
 * with its security colour; the text is always dark (`node-pill-text`).
 */
export function classPill(info: Pick<UniverseSystemDto, 'whClass' | 'security'> | undefined): ClassPill {
  if (!info) return { kind: 'unknown', label: '?' };
  const c = info.whClass;
  if (c !== null && c >= 1 && c <= 6) return { kind: 'class', label: `C${c}`, token: 'pill-wormhole' };
  if (c === 12) return { kind: 'class', label: 'Thera', token: 'pill-special' };
  if (c === 13) return { kind: 'class', label: 'C13', token: 'pill-special' };
  if (c !== null && c >= 14 && c <= 18) return { kind: 'class', label: 'Drifter', token: 'pill-special' };
  if (c === 25) return { kind: 'class', label: 'Pochven', token: 'pill-special' };
  const shown = shownSecurity(info.security);
  const step = Math.max(0, Math.min(1, shown)).toFixed(1);
  const background = SECURITY_COLORS[step]!;
  return { kind: 'security', label: shown.toFixed(1), background };
}

/**
 * A system of each destination, for pills of a class rather than a system (the wormhole types
 * reference): the SDE class id, and for known space a security in the middle of its band.
 */
const DESTINATION_SYSTEM: Record<WormholeDestination, Pick<UniverseSystemDto, 'whClass' | 'security'>> = {
  c1: { whClass: 1, security: -1 },
  c2: { whClass: 2, security: -1 },
  c3: { whClass: 3, security: -1 },
  c4: { whClass: 4, security: -1 },
  c5: { whClass: 5, security: -1 },
  c6: { whClass: 6, security: -1 },
  hs: { whClass: 7, security: 0.8 },
  ls: { whClass: 8, security: 0.3 },
  ns: { whClass: 9, security: -0.5 },
  thera: { whClass: 12, security: -1 },
  c13: { whClass: 13, security: -1 },
  drifter: { whClass: 14, security: -1 },
  pochven: { whClass: 25, security: -1 },
};

/** The pill of a destination class in the colours of the map's nodes; labels stay the caller's. */
export function destinationPill(destination: WormholeDestination): Exclude<ClassPill, { kind: 'unknown' }> {
  return classPill(DESTINATION_SYSTEM[destination]) as Exclude<ClassPill, { kind: 'unknown' }>;
}

/**
 * Nearest hub under an exit, as the routing API answers it: "Jita 4j" and the route's space.
 * `rules` says how it was routed: `viewer` with the viewer's own route options, exactly as their
 * Routes widget routes from that exit; `shared` the map-wide fallback (shortest, stargates, the
 * chain and bridges, no EVE-Scout holes), shown only when the viewer's own could not be loaded.
 */
export interface NearestHub {
  name: string;
  jumps: number;
  space: RouteSpace | null;
  rules: 'viewer' | 'shared';
}

/**
 * The square after the hub, only when the whole route runs through one kind of space: the game's
 * own security colour of that space (0.8 for high-sec, 0.4 for low-sec, 0.0 for null-sec), the
 * same in every theme.
 */
export const ROUTE_SPACE_COLOR: Partial<Record<RouteSpace, string>> = {
  high: SECURITY_COLORS['0.8']!,
  low: SECURITY_COLORS['0.4']!,
  null: SECURITY_COLORS['0.0']!,
};

export const ROUTE_SPACE_TEXT: Record<RouteSpace, string> = {
  high: 'all in high-sec',
  low: 'all in low-sec',
  null: 'all in null-sec',
  mixed: 'through mixed space',
};

/**
 * Nearest hubs of the chain's exits by system: known-space systems the chain reaches through a
 * wormhole (the routing API's `connected` exits) that have a route to a hub.
 */
export function exitHubs(
  exits: readonly MapExitDto[] | null | undefined,
  rules: NearestHub['rules'] = 'viewer',
): Map<number, NearestHub> {
  const hubs = new Map<number, NearestHub>();
  for (const exit of exits ?? []) {
    if (exit.kind !== 'connected' || !exit.nearest || exit.nearest.jumps === null) continue;
    hubs.set(exit.solarSystemId, {
      name: exit.nearest.name,
      jumps: exit.nearest.jumps,
      space: exit.nearest.space ?? null,
      rules,
    });
  }
  return hubs;
}

/**
 * The nearest-hub chips of the exits: the viewer's own exits (routed with their route options,
 * exactly as their Routes widget routes from each exit) once loaded. The map-wide ones stand in
 * only when the viewer's cannot be had (`fallback`: a public view, a failed request); while the
 * viewer's load, no chip, rather than a number the Routes widget would contradict.
 */
export function exitChips(
  viewer: readonly MapExitDto[] | undefined,
  shared: readonly MapExitDto[] | null | undefined,
  fallback: boolean,
): Map<number, NearestHub> {
  if (viewer) return exitHubs(viewer, 'viewer');
  return fallback ? exitHubs(shared, 'shared') : exitHubs(null);
}

/** The chip's tooltip: which hub, how far from which system, and routed how. */
export function nearestHubTitle(hub: NearestHub, from: string): string {
  const jumps = `${hub.jumps} jump${hub.jumps === 1 ? '' : 's'} from ${from}`;
  const space = hub.space ? `, ${ROUTE_SPACE_TEXT[hub.space]}` : '';
  const how =
    hub.rules === 'viewer'
      ? 'with your route options, as the Routes widget routes from here'
      : 'shortest way, without Thera and Turnur holes (your route options did not load)';
  return `Nearest hub: ${hub.name}, ${jumps}${space}; ${how}`;
}
