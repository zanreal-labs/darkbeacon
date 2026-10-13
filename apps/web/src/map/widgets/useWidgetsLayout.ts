'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreferences, useSavePreferences } from '../../lib/preferences';
import {
  EMPTY_LAYOUT,
  isLayout,
  LAYOUT_KEY,
  migrateSidebarLayout,
  placeNew,
  raise,
  resolveBoxes,
  setVisible,
  toStored,
  visibleIds,
  type Area,
  type Box,
  type WidgetsLayout,
} from './layout';
import { readStored, writeStored } from './storage';

const read = (): WidgetsLayout =>
  (typeof window === 'undefined' ? null : readStored(LAYOUT_KEY, isLayout)) ?? EMPTY_LAYOUT;

export interface WidgetsController {
  layout: WidgetsLayout;
  /** Ids of the widgets shown, in the menu's sense (the windows may all be hidden for a moment). */
  visible: readonly string[];
  isVisible(id: string): boolean;
  /** Shows or hides one; a window turned on gets a free spot on the map. */
  setShown(id: string, on: boolean): void;
  /** Keeps where a window was dragged or resized to. */
  place(id: string, box: Box, area: Area): void;
  /** Brings a window to the front. */
  raise(id: string): void;
  /** Wanderer's "Reset widgets": the default set in the default layout. */
  reset(): void;
  /** The map's size, reported by the windows' layer: new windows are placed against it. */
  setArea(area: Area): void;
}

/**
 * Which widgets show and where their windows are: one `dbk-*` option of this browser, so it follows
 * the person through their preferences. The old sidebar's hidden sections become hidden widgets
 * once, the first time.
 */
export function useWidgetsLayout(): WidgetsController {
  const [layout, setLayout] = useState<WidgetsLayout>(read);
  const area = useRef<Area | null>(null);

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
      setShown: (id, on) =>
        update((current) => {
          const size = area.current;
          if (!on || !size || current.boxes[id]) return setVisible(current, id, on);
          const others = Object.values(resolveBoxes(current, size, visibleIds(current)));
          return setVisible(current, id, true, toStored(placeNew(id, size, others), size));
        }),
      place: (id, box, size) =>
        update((current) => ({
          ...current,
          boxes: { ...current.boxes, [id]: toStored(box, size) },
          order: raise(current.order, id),
        })),
      raise: (id) =>
        update((current) => {
          const order = raise(current.order, id);
          return order === current.order ? current : { ...current, order };
        }),
      reset: () => update(() => EMPTY_LAYOUT),
      setArea: (next) => {
        area.current = next;
      },
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
    if (hidden && !readStored(LAYOUT_KEY, isLayout))
      update((current) => (current.visible === null ? { ...current, visible: hidden } : current));
    void save({ sidebar: null }).catch(() => undefined);
  }, [loaded, old, save, update]);
}
