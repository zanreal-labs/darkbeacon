'use client';

import { useSyncExternalStore } from 'react';

/*
 * How this browser draws and handles the map canvas (Wanderer's interface settings): the minimap
 * and where the rally card sits, snapping, the background, the drag mode, following your own
 * jumps and where Dotlan opens. Kept in localStorage under one key, so a preferences export can
 * carry it; everything works with the defaults when storage is blocked.
 */

export const CANVAS_PREFS_KEY = 'dbk-canvas-prefs';

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type Corner = (typeof CORNERS)[number];

/** Dotlan's system page, or the region map with one of its layers (Wanderer's `DotlanBehavior`). */
export const DOTLAN_TARGETS = [
  'system',
  'sec',
  'sov',
  'const',
  'jumps',
  'kills',
  'npc',
  'npc_delta',
] as const;
export type DotlanTarget = (typeof DOTLAN_TARGETS)[number];

export interface CanvasPrefs {
  /** Where the minimap sits, or none. */
  minimap: Corner | 'off';
  /** Where the rally card sits. */
  pings: Corner;
  /** Dragged systems land on the grid. */
  snapToGrid: boolean;
  background: 'dots' | 'lines' | 'none';
  /** A calmer, flatter canvas colour. */
  softBackground: boolean;
  /** A left drag on the canvas draws a selection box and a right drag pans (Pathfinder's way). */
  dragSelects: boolean;
  /** When one of your characters jumps into a system, it is selected. */
  selectOnJump: boolean;
  dotlan: DotlanTarget;
}

export const DEFAULT_CANVAS_PREFS: CanvasPrefs = {
  // On, beside the view controls at the bottom left (the right side is the widgets' column).
  minimap: 'bottom-left',
  pings: 'top-right',
  snapToGrid: true,
  background: 'dots',
  softBackground: false,
  dragSelects: false,
  selectOnJump: false,
  dotlan: 'system',
};

/**
 * The grid dragged systems snap to, in map pixels: the background's dot spacing, so a system's
 * corner always lands on a dot and rows and columns line up exactly.
 */
export const SNAP_GRID: [number, number] = [24, 24];

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const VALID: { [K in keyof CanvasPrefs]: (v: unknown) => v is CanvasPrefs[K] } = {
  minimap: oneOf([...CORNERS, 'off'] as const),
  pings: oneOf(CORNERS),
  snapToGrid: isBool,
  background: oneOf(['dots', 'lines', 'none'] as const),
  softBackground: isBool,
  dragSelects: isBool,
  selectOnJump: isBool,
  dotlan: oneOf(DOTLAN_TARGETS),
};

/** Stored values over the defaults; anything unknown or invalid falls back to its default. */
export function parseCanvasPrefs(raw: unknown): CanvasPrefs {
  const out: CanvasPrefs = { ...DEFAULT_CANVAS_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(VALID) as Array<keyof CanvasPrefs>) {
    if (VALID[key](record[key])) (out as unknown as Record<string, unknown>)[key] = record[key];
  }
  return out;
}

let cache: CanvasPrefs | null = null;
const listeners = new Set<() => void>();

function read(): CanvasPrefs {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(CANVAS_PREFS_KEY);
    cache = parseCanvasPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    cache = { ...DEFAULT_CANVAS_PREFS };
  }
  return cache;
}

/** The current preferences (defaults on the server and when storage is blocked). */
export function canvasPrefs(): CanvasPrefs {
  return typeof window === 'undefined' ? DEFAULT_CANVAS_PREFS : read();
}

export function setCanvasPrefs(patch: Partial<CanvasPrefs>): void {
  cache = { ...read(), ...patch };
  try {
    window.localStorage.setItem(CANVAS_PREFS_KEY, JSON.stringify(cache));
  } catch {
    // Storage may be blocked: the choice lasts for this page.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed them: read again.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CANVAS_PREFS_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCanvasPrefs(): CanvasPrefs {
  return useSyncExternalStore(subscribe, canvasPrefs, () => DEFAULT_CANVAS_PREFS);
}

/** Where Dotlan opens for a system, per the preference; wormholes always get their system page. */
export function dotlanUrl(
  target: DotlanTarget,
  system: { name: string; regionName?: string | null; wormhole: boolean },
): string {
  const slug = (text: string) => encodeURIComponent(text.replace(/ /g, '_'));
  if (target === 'system' || system.wormhole || !system.regionName)
    return `https://evemaps.dotlan.net/system/${slug(system.name)}`;
  return `https://evemaps.dotlan.net/map/${slug(system.regionName)}/${slug(system.name)}#${target}`;
}
