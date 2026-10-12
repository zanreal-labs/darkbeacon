'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type UserPreferencesDto } from '@darkbeacon/shared';
import { api } from './api';

/*
 * "My preferences": per-person options kept on the server, so they follow the person between
 * browsers and can be exported, imported and reset in one place.
 *
 * - Areas Darkbeacon reads through `usePreference` live on the server only (Local, sidebar
 *   sections, On the map).
 * - Options other parts of the app keep in this browser's localStorage (`dbk-*`: signature
 *   columns, the map legend, kills and routes options...) are mirrored into the `browser` area:
 *   pulled into a browser that has none of them, pushed when the page is hidden.
 */

export const preferencesKey = ['user-preferences'] as const;

/** The area holding mirrored localStorage options. */
export const BROWSER_AREA = 'browser';
/** Kept per device: the sidebar's width fits one screen; the theme is already on the account. */
const LOCAL_ONLY = new Set(['dbk-sidebar-width', 'dbk-theme-preference']);
const MIRRORED = (key: string) => key.startsWith('dbk-') && !LOCAL_ONLY.has(key);

const EMPTY: UserPreferencesDto = { preferences: {}, updatedAt: 0 };

export function usePreferences({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: () => api<UserPreferencesDto>(routes.characters.preferences.path),
    staleTime: Infinity,
    retry: false,
    enabled,
  });
}

/** Saves areas (null removes one), applying them at once and rolling back if the server refuses. */
export function useSavePreferences() {
  const client = useQueryClient();
  return useCallback(
    async (areas: Record<string, unknown>) => {
      const previous = client.getQueryData<UserPreferencesDto>(preferencesKey) ?? EMPTY;
      const next = { ...previous.preferences };
      for (const [area, value] of Object.entries(areas)) {
        if (value === null) delete next[area];
        else next[area] = value;
      }
      client.setQueryData<UserPreferencesDto>(preferencesKey, { ...previous, preferences: next });
      try {
        const saved = await api<UserPreferencesDto>(routes.characters.updatePreferences.path, {
          method: 'PUT',
          json: { preferences: areas },
        });
        client.setQueryData(preferencesKey, saved);
        return saved;
      } catch (error) {
        client.setQueryData(preferencesKey, previous);
        throw error;
      }
    },
    [client],
  );
}

/**
 * One area of my preferences with its defaults: what the server holds when it is valid, the
 * defaults otherwise. Setting merges a patch into the area.
 */
export function usePreference<T extends object>(
  area: string,
  defaults: T,
  valid: (value: unknown) => value is T,
): [T, (patch: Partial<T>) => void] {
  const query = usePreferences();
  const save = useSavePreferences();
  const stored = query.data?.preferences[area];
  const value = valid(stored) ? { ...defaults, ...stored } : defaults;
  const text = JSON.stringify(value);
  const set = useCallback(
    (patch: Partial<T>) => {
      void save({ [area]: { ...(JSON.parse(text) as T), ...patch } }).catch(() => undefined);
    },
    [area, save, text],
  );
  return [value, set];
}

/** The `dbk-*` options of this browser that follow the person (see MIRRORED). */
export function readBrowserOptions(): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !MIRRORED(key)) continue;
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      try {
        found[key] = JSON.parse(raw) as unknown;
      } catch {
        found[key] = raw;
      }
    }
  } catch {
    // Storage blocked: nothing to mirror.
  }
  return found;
}

/** Writes mirrored options into this browser; `replace` first removes the ones not given. */
export function writeBrowserOptions(options: Record<string, unknown>, replace = false): void {
  try {
    if (replace)
      for (const key of Object.keys(readBrowserOptions()))
        if (!(key in options)) window.localStorage.removeItem(key);
    for (const [key, value] of Object.entries(options)) {
      if (!MIRRORED(key)) continue;
      window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  } catch {
    // Storage blocked: the options stay on the server.
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Keeps this browser's `dbk-*` options and the `browser` area in step: a browser without any
 * takes the server's (they apply from the next page load), and changes made here are pushed
 * whenever the page is hidden.
 */
export function usePreferenceMirror(enabled: boolean): void {
  const preferences = usePreferences({ enabled });
  const save = useSavePreferences();
  const loaded = preferences.isSuccess;
  useEffect(() => {
    if (!enabled || !loaded) return;
    const stored = preferences.data?.preferences[BROWSER_AREA];
    const local = readBrowserOptions();
    if (isRecord(stored) && Object.keys(local).length === 0) writeBrowserOptions(stored);
    let last = JSON.stringify(isRecord(stored) ? stored : {});
    const push = () => {
      const now = readBrowserOptions();
      const text = JSON.stringify(now);
      if (text === last || Object.keys(now).length === 0) return;
      last = text;
      void save({ [BROWSER_AREA]: now }).catch(() => undefined);
    };
    const onVisibility = () => document.visibilityState === 'hidden' && push();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', push);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', push);
    };
    // Only once the server's copy is known; later changes come from this browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loaded, save]);
}

/** What "Export" writes: every area, with this browser's mirrored options as they are now. */
export interface PreferencesFile {
  darkbeacon: 'preferences';
  version: 1;
  exportedAt: string;
  preferences: Record<string, unknown>;
}

export function exportPreferences(server: Record<string, unknown>): PreferencesFile {
  return {
    darkbeacon: 'preferences',
    version: 1,
    exportedAt: new Date().toISOString(),
    preferences: { ...server, [BROWSER_AREA]: readBrowserOptions() },
  };
}

/** The areas of an exported file, or an error message when it is not one. */
export function parsePreferencesFile(text: string): Record<string, unknown> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'That file is not JSON.';
  }
  if (!isRecord(parsed) || parsed.darkbeacon !== 'preferences' || !isRecord(parsed.preferences))
    return 'That file is not a Darkbeacon preferences export.';
  return parsed.preferences;
}
