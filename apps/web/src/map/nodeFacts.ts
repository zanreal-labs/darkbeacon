import type { MapExitDto, RouteSpace, SystemStatus, UniverseSystemDto } from '@darkbeacon/shared';
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

/** Every label a pill can show, for sizing the node (see node-sizers.ts). */
export const PILL_LABELS = ['C6', '-1.0', '0.5', 'Thera', 'C13', 'Drifter', 'Pochven'];

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

/** Nearest hub under an exit, as the routing API answers it: "Jita 4j" and the route's space. */
export interface NearestHub {
  name: string;
  jumps: number;
  space: RouteSpace | null;
}

/** The square after the hub: only when the whole route runs through one kind of space. */
export const ROUTE_SPACE_TOKEN: Partial<Record<RouteSpace, TokenName>> = {
  high: 'security-high',
  low: 'security-low',
  null: 'security-null',
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
export function exitHubs(exits: readonly MapExitDto[] | null | undefined): Map<number, NearestHub> {
  const hubs = new Map<number, NearestHub>();
  for (const exit of exits ?? []) {
    if (exit.kind !== 'connected' || !exit.nearest || exit.nearest.jumps === null) continue;
    hubs.set(exit.solarSystemId, {
      name: exit.nearest.name,
      jumps: exit.nearest.jumps,
      space: exit.nearest.space ?? null,
    });
  }
  return hubs;
}
