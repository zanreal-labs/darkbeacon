'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

/*
 * Conveniences of this browser (the sidebar's width, which sections are folded): kept in
 * localStorage, and the sidebar works the same when storage is blocked.
 */

export const WIDTH_KEY = 'dbk-sidebar-width';
export const COLLAPSED_KEY = 'dbk-sidebar-collapsed';

export function readStored<T>(key: string, valid: (v: unknown) => v is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be blocked; the sidebar works without it.
  }
}

const isFlags = (v: unknown): v is Record<string, boolean> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Open or folded, by section id: only what someone chose, the rest follows the defaults. */
export const OPEN_KEY = 'dbk-sidebar-open';

/**
 * Which sections of the system sidebar are open: the defaults (`defaultOpen`) until someone opens
 * or folds one, then their choice, remembered (and, as a `dbk-*` option, following them to their
 * other browsers through their preferences).
 */
export function useOpenSections(defaultOpen: readonly string[]) {
  const [chosen, setChosen] = useState<Record<string, boolean>>(
    () => (typeof window === 'undefined' ? null : readStored(OPEN_KEY, isFlags)) ?? {},
  );
  const defaults = defaultOpen.join(',');
  const isOpen = useCallback(
    (id: string) => chosen[id] ?? defaults.split(',').includes(id),
    [chosen, defaults],
  );
  const set = useCallback(
    (id: string, open: (current: boolean) => boolean) =>
      setChosen((current) => {
        const was = current[id] ?? defaults.split(',').includes(id);
        const now = open(was);
        if (now === was) return current;
        const next = { ...current, [id]: now };
        writeStored(OPEN_KEY, next);
        return next;
      }),
    [defaults],
  );
  const toggle = useCallback((id: string) => set(id, (was) => !was), [set]);
  const expand = useCallback((id: string) => set(id, () => true), [set]);
  return { isOpen, toggle, expand };
}

/** Folded sections by id, remembered across visits (the connection sidebar). */
export function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => (typeof window === 'undefined' ? null : readStored(COLLAPSED_KEY, isFlags)) ?? {},
  );
  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      if (!next[id]) delete next[id];
      writeStored(COLLAPSED_KEY, next);
      return next;
    });
  }, []);
  const expand = useCallback((id: string) => {
    setCollapsed((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      writeStored(COLLAPSED_KEY, next);
      return next;
    });
  }, []);
  return { collapsed, toggle, expand };
}

export const PHONE_QUERY = '(max-width: 760px)';

function subscribePhone(onChange: () => void) {
  const media = window.matchMedia?.(PHONE_QUERY);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

/** True on phone-sized screens, where the sidebar is a bottom sheet. Follows rotation and resizing. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia?.(PHONE_QUERY).matches ?? false,
    () => false,
  );
}
