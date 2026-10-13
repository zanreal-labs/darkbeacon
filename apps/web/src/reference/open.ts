'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the wormhole types reference is open, and what it was opened for. One reference for the
 * whole app (`WormholeReferenceHost` in the shell): the rail, the help menu, the W key, the map's
 * menus and every clickable type code open the same one.
 */
export interface ReferenceState {
  open: boolean;
  /** The search it opens with: a type code ("U210") or nothing. */
  query: string;
  /** Counts openings, so opening it again for another code starts afresh. */
  opened: number;
}

let state: ReferenceState = { open: false, query: '', opened: 0 };
const listeners = new Set<() => void>();
const CLOSED: ReferenceState = { open: false, query: '', opened: 0 };

function set(next: ReferenceState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Opens the reference, searching for `query` (a type code) when given. */
export function openWormholeReference(query = ''): void {
  set({ open: true, query: query.trim().toUpperCase(), opened: state.opened + 1 });
}

export function closeWormholeReference(): void {
  if (state.open) set({ ...state, open: false });
}

/** The state right now, outside React. */
export function wormholeReferenceState(): ReferenceState {
  return state;
}

export function useWormholeReference(): ReferenceState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => CLOSED,
  );
}
