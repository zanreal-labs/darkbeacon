'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreferences, useSavePreferences } from '../../lib/preferences';
import {
  EMPTY_LAYOUT,
  fitToContent,
  LAYOUT_KEY,
  migrateSidebarLayout,
  parseLayout,
  placeFloating,
  raise,
  resizeDocked,
  setVisible,
  visibleIds,
  type Area,
  type Box,
  type WidgetsLayout,
} from './layout';
import { readStored, writeStored } from './storage';

const anything = (v: unknown): v is unknown => v !== null;

/** The layout this browser keeps, in this version's terms (null: none kept). */
const readKept = (): WidgetsLayout | null =>
  typeof window === 'undefined' ? null : parseLayout(readStored(LAYOUT_KEY, anything));

const read = (): WidgetsLayout => readKept() ?? EMPTY_LAYOUT;

export interface WidgetsController {
  layout: WidgetsLayout;
  /** Ids of the widgets shown, in the menu's sense (the windows may all be hidden for a moment). */
  visible: readonly string[];
  isVisible(id: string): boolean;
  /** Shows or hides one; a window turned on joins the column. */
  setShown(id: string, on: boolean): void;
  /**
   * Keeps where a window was dragged or resized to: out of the column, it floats there. A resize
   * by hand fixes its height; `below` is the floating window it was dropped right under.
   */
  place(id: string, box: Box, area: Area, how?: { resized?: boolean; below?: string | undefined }): void;
  /** A docked window resized by hand: the height it keeps, and the column's width. */
  resizeDocked(id: string, box: Box, area: Area): void;
  /** Back to the content's height: one window, or every window without an id. */
  fit(id?: string): void;
  /** Brings a window to the front. */
  raise(id: string): void;
  /** Wanderer's "Reset widgets": the default set, every window back in the column. */
  reset(): void;
  /** Puts a whole layout in place at once (a saved view of the map). */
  replace(layout: WidgetsLayout): void;
}

/**
 * Which widgets show and where their windows are: one `dbk-*` option of this browser, so it follows
 * the person through their preferences. The old sidebar's hidden sections become hidden widgets
 * once, the first time.
 */
export function useWidgetsLayout(): WidgetsController {
  const [layout, setLayout] = useState<WidgetsLayout>(read);

  const update = useCallback((change: (current: WidgetsLayout) => WidgetsLayout) => {
    setLayout((current) => {
      const next = change(current);
      if (next !== current) writeStored(LAYOUT_KEY, next);
      return next;
    });
  }, []);

  // Another tab, or the preferences mirror, changed it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAYOUT_KEY || e.key === null) setLayout(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useSidebarMigration(update);

  return useMemo(() => {
    const visible = visibleIds(layout);
    return {
      layout,
      visible,
      isVisible: (id) => visible.includes(id),
      setShown: (id, on) => update((current) => setVisible(current, id, on)),
      place: (id, box, size, how) => update((current) => placeFloating(current, id, box, size, how)),
      resizeDocked: (id, box, size) =>
        update((current) => ({ ...resizeDocked(current, id, box, size), order: raise(current.order, id) })),
      raise: (id) =>
        update((current) => {
          const order = raise(current.order, id);
          return order === current.order ? current : { ...current, order };
        }),
      fit: (id) =>
        update((current) => {
          const next = fitToContent(current, id);
          return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        }),
      reset: () => update(() => EMPTY_LAYOUT),
      replace: (next) => update(() => parseLayout(next) ?? EMPTY_LAYOUT),
    };
  }, [layout, update]);
}

/**
 * The system sidebar's sections someone hid (the `sidebar` preferences area) carry over as hidden
 * widgets, once; then the area and the sidebar's own keys go.
 */
function useSidebarMigration(update: (change: (current: WidgetsLayout) => WidgetsLayout) => void) {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const loaded = preferences.isSuccess;
  const old = preferences.data?.preferences.sidebar;
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !loaded) return;
    done.current = true;
    try {
      window.localStorage.removeItem('dbk-sidebar-open');
    } catch {
      // Storage blocked: nothing to remove.
    }
    if (old === undefined) return;
    const hidden = migrateSidebarLayout(old);
    if (hidden && !readKept())
      update((current) => (current.visible === null ? { ...current, visible: hidden } : current));
    void save({ sidebar: null }).catch(() => undefined);
  }, [loaded, old, save, update]);
}
