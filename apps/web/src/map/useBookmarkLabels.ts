'use client';

import { useMemo } from 'react';
import {
  bookmarkChain,
  bookmarkClassLabel,
  bookmarkLabel,
  DEFAULT_BOOKMARK_TEMPLATE,
  type MapPreferencesDto,
  type SystemLabelDto,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import type { MapState } from './mapState';

/**
 * The bookmark label above each system (`ABC-123`, or the viewer's template), by system id: what
 * the canvas draws and what Edit system previews (null: none). Empty while `enabled` is false.
 */
export function useBookmarkLabels({
  state,
  universe,
  systemLabels,
  preferences,
  enabled = true,
}: {
  state: MapState;
  universe: ReadonlyMap<number, UniverseSystemDto>;
  systemLabels: readonly SystemLabelDto[];
  preferences: MapPreferencesDto;
  enabled?: boolean;
}): ReadonlyMap<number, string | null> {
  const template =
    preferences.bookmarkTemplate ?? state.map?.settings.bookmarkTemplate ?? DEFAULT_BOOKMARK_TEMPLATE;
  // `{n}` in the viewer's own order is counted here; in the map's order it is the shared number.
  const mapOrder = state.map?.settings.bookmarkNumbering?.order ?? 'found';
  const startAtZero = state.map?.settings.bookmarkNumbering?.startAtZero;
  const values = state.map?.settings.bookmarkNumbering?.values;
  const ownOrder =
    preferences.bookmarkOrder && preferences.bookmarkOrder !== mapOrder
      ? preferences.bookmarkOrder
      : undefined;
  return useMemo(() => {
    if (!enabled) return new Map<number, string | null>();
    const chain = bookmarkChain({
      systems: [...state.systems.values()],
      connections: [...state.connections.values()],
      signatures: [...state.signatures.values()],
      classOf: (id) => bookmarkClassLabel(universe.get(id)),
      systemLabels,
      // Stored numbers are the sources' own on a merged map: it counts in its order here.
      order: ownOrder ?? (state.sources ? mapOrder : undefined),
      startAtZero,
      staticsOf: (id) => universe.get(id)?.statics,
    });
    return new Map([...chain].map(([id, vars]) => [id, bookmarkLabel(template, vars, values)]));
  }, [
    enabled,
    state.systems,
    state.connections,
    state.signatures,
    state.sources,
    systemLabels,
    universe,
    template,
    ownOrder,
    mapOrder,
    startAtZero,
    values,
  ]);
}
