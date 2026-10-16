'use client';

import { useSyncExternalStore } from 'react';

/*
 * Whether this browser shows the size legend under the wormhole types table. Off until turned on;
 * kept in localStorage, and everything works with the default when storage is blocked.
 */

export const REFERENCE_LEGEND_KEY = 'dbk-wormhole-reference-legend';

let cache: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(REFERENCE_LEGEND_KEY) === 'on';
  } catch {
    return false;
  }
}

function legendShown(): boolean {
  if (typeof window === 'undefined') return false;
  cache ??= read();
  return cache;
}

export function setLegendShown(shown: boolean): void {
  cache = shown;
  try {
    if (shown) window.localStorage.setItem(REFERENCE_LEGEND_KEY, 'on');
    else window.localStorage.removeItem(REFERENCE_LEGEND_KEY);
  } catch {
    // Storage may be blocked; the choice holds until the page is left.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== REFERENCE_LEGEND_KEY) return;
    cache = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The size legend's toggle: off by default, remembered per browser. */
export function useLegendShown(): boolean {
  return useSyncExternalStore(subscribe, legendShown, () => false);
}

/** Forget the cached choice (tests clear localStorage between cases). */
export function resetLegendCache(): void {
  cache = null;
}
