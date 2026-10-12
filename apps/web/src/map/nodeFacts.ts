import {
  wormholeDestination,
  type ConnectionDto,
  type SystemStatus,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { readableTextOn } from '@darkbeacon/theme-sdk';

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
 * Security colours from deep blue-green at 1.0 through yellow at 0.5 to red at 0.0 and below,
 * the gradient the game's map and route planner use. Exact client values are not published, so
 * these are our own steps along it; each one is used as a pill fill with black or white text,
 * whichever passes WCAG AA, so they read the same in every theme.
 */
export const SECURITY_COLORS: Readonly<Record<string, string>> = {
  '1.0': '#33c7e8',
  '0.9': '#36d6bf',
  '0.8': '#3bd27a',
  '0.7': '#4cc63f',
  '0.6': '#9ccc32',
  '0.5': '#e3d62c',
  '0.4': '#f0a12a',
  '0.3': '#ef7f2a',
  '0.2': '#e8602c',
  '0.1': '#de4530',
  '0.0': '#c42a2a',
};

/** Security as the game shows it: one decimal, 0.0 < s < 0.05 rounded up to 0.1. */
export function shownSecurity(security: number): number {
  if (security > 0 && security < 0.05) return 0.1;
  return Math.round(security * 10) / 10;
}

export type ClassPill =
  | { kind: 'security'; label: string; background: string; color: string }
  | { kind: 'class'; label: string; token: 'security-wormhole' | 'security-special' }
  | { kind: 'unknown'; label: string };

/** Every label a pill can show, for sizing the node (see node-sizers.ts). */
export const PILL_LABELS = ['C6', '-1.0', '0.5', 'Thera', 'C13', 'Drifter', 'Pochven'];

/** The class or security pill: wormhole classes tinted, known space filled with its security colour. */
export function classPill(info: Pick<UniverseSystemDto, 'whClass' | 'security'> | undefined): ClassPill {
  if (!info) return { kind: 'unknown', label: '?' };
  const c = info.whClass;
  if (c !== null && c >= 1 && c <= 6) return { kind: 'class', label: `C${c}`, token: 'security-wormhole' };
  if (c === 12) return { kind: 'class', label: 'Thera', token: 'security-special' };
  if (c === 13) return { kind: 'class', label: 'C13', token: 'security-special' };
  if (c !== null && c >= 14 && c <= 18) return { kind: 'class', label: 'Drifter', token: 'security-special' };
  if (c === 25) return { kind: 'class', label: 'Pochven', token: 'security-special' };
  const shown = shownSecurity(info.security);
  const step = Math.max(0, Math.min(1, shown)).toFixed(1);
  const background = SECURITY_COLORS[step]!;
  return { kind: 'security', label: shown.toFixed(1), background, color: readableTextOn(background) };
}

/** H, L or N for known space by shown security; null for wormhole and special space. */
export function knownSpaceLetter(
  info: Pick<UniverseSystemDto, 'whClass' | 'security'> | undefined,
): string | null {
  if (!info) return null;
  if (info.whClass !== null && ![7, 8, 9].includes(info.whClass)) return null;
  const shown = shownSecurity(info.security);
  return shown >= 0.5 ? 'H' : shown > 0 ? 'L' : 'N';
}

const DESTINATION_LETTER: Partial<Record<string, string>> = { hs: 'H', ls: 'L', ns: 'N' };

/**
 * Where a system lets the chain out to known space: a known-space system the map reaches through
 * a wormhole is an exit itself ("EXIT L"); a wormhole system with statics into known space has
 * those exits ("EXIT H/L"). Empty when it is none.
 */
export function exitLetters(
  solarSystemId: number,
  info: UniverseSystemDto | undefined,
  connections: Iterable<ConnectionDto>,
): string[] {
  if (!info) return [];
  const own = knownSpaceLetter(info);
  if (own) {
    for (const c of connections) {
      if (c.type === 'wormhole' && (c.source === solarSystemId || c.target === solarSystemId)) return [own];
    }
    return [];
  }
  const letters = new Set(
    info.statics.flatMap((type) => {
      const to = wormholeDestination(type);
      const letter = to ? DESTINATION_LETTER[to] : undefined;
      return letter ? [letter] : [];
    }),
  );
  return ['H', 'L', 'N'].filter((l) => letters.has(l));
}

/** Nearest trade hub from an exit, as the routing API answers it ("Jita 12j"). */
export interface NearestHub {
  name: string;
  jumps: number;
}
