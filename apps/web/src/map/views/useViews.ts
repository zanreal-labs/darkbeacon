'use client';

import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { buildPath, routes, type MapViewDto, type ViewSlot } from '@darkbeacon/shared';
import { api } from '../../lib/api';
import { usePreferences, useSavePreferences } from '../../lib/preferences';
import { setCanvasPrefs, useCanvasPrefs } from '../canvas/prefs';
import type { WidgetsController } from '../widgets/useWidgetsLayout';
import {
  captureView,
  mapViews,
  newViewId,
  parsePersonalViews,
  resolveSlots,
  showsView,
  toMapView,
  VIEWS_AREA,
  type NamedView,
  type PersonalViews,
  type ViewPreset,
  type ViewRef,
} from './format';

export interface ViewsController {
  /** My own views. */
  personal: NamedView[];
  /** The map's published views. */
  published: NamedView[];
  /** What quick slots 1, 2 and 3 show. */
  slots: ReturnType<typeof resolveSlots>;
  /** The slot whose view the screen shows now, if any. */
  active: ViewSlot | null;
  /** I pinned something over the map's defaults here. */
  hasPins: boolean;
  /** The map's managers publish views. */
  canPublish: boolean;
  apply(view: NamedView): void;
  applySlot(slot: ViewSlot): void;
  /** The screen as it is now. */
  current(): ViewPreset;
  saveAs(name: string): Promise<string>;
  overwrite(ref: ViewRef): Promise<void>;
  rename(ref: ViewRef, name: string): Promise<void>;
  remove(ref: ViewRef): Promise<void>;
  pin(slot: ViewSlot, ref: ViewRef): Promise<void>;
  resetPins(): Promise<void>;
  /** Publishes a view to the map, optionally as everyone's default on a slot. */
  publish(name: string, view: ViewPreset, slot: ViewSlot | undefined): Promise<void>;
  /** A map view's slot for everyone (undefined: none). */
  setMapSlot(id: string, slot: ViewSlot | undefined): Promise<void>;
}

/**
 * Saved views on one map: mine (my preferences, so they follow me), the map's (published by its
 * managers, live with the map), the quick slots and applying a view at once, without a reload.
 */
export function useViews({
  mapId,
  views,
  canPublish,
  widgets,
  onApplied,
}: {
  mapId: string;
  /** The map's published views as the live map has them. */
  views: readonly MapViewDto[] | undefined;
  canPublish: boolean;
  widgets: WidgetsController;
  /** After a view went on the screen (the widgets show again if they were hidden). */
  onApplied?(view: NamedView): void;
}): ViewsController {
  const preferences = usePreferences();
  const savePreferences = useSavePreferences();
  const prefs = useCanvasPrefs();
  const stored = preferences.data?.preferences[VIEWS_AREA];
  const mine = useMemo(() => parsePersonalViews(stored), [stored]);
  const published = useMemo(() => mapViews(views), [views]);
  const personal = useMemo(
    () => mine.views.map((v): NamedView => ({ source: 'personal', id: v.id, name: v.name, view: v.view })),
    [mine],
  );
  const slots = useMemo(() => resolveSlots(mapId, mine, published), [mapId, mine, published]);
  const active = slots.find((s) => showsView(s.view.view, widgets.layout, prefs))?.slot ?? null;

  const putMap = useMutation({
    mutationFn: (list: MapViewDto[]) =>
      api<MapViewDto[]>(buildPath(routes.maps.setViews.path, { mapId }), {
        method: 'PUT',
        json: { views: list },
      }),
  });
  const savePersonal = useCallback(
    (next: PersonalViews) => savePreferences({ [VIEWS_AREA]: next }).then(() => undefined),
    [savePreferences],
  );

  const apply = useCallback(
    (view: NamedView) => {
      widgets.replace(view.view.layout);
      if (Object.keys(view.view.canvas).length > 0) setCanvasPrefs(view.view.canvas);
      onApplied?.(view);
    },
    [widgets, onApplied],
  );

  const current = useCallback(() => captureView(widgets.layout, prefs), [widgets.layout, prefs]);
  const now = () => Date.now();
  const listed = (views ?? []).map((v) => ({ ...v }));
  const changeMap = (change: (list: MapViewDto[]) => MapViewDto[]) =>
    putMap.mutateAsync(change(listed)).then(() => undefined);

  return {
    personal,
    published,
    slots,
    active,
    hasPins: Object.keys(mine.pins[mapId] ?? {}).length > 0,
    canPublish,
    apply,
    applySlot: (slot) => {
      const found = slots.find((s) => s.slot === slot);
      if (found) apply(found.view);
    },
    current,
    saveAs: async (name) => {
      const id = newViewId('p');
      await savePersonal({
        ...mine,
        views: [...mine.views, { id, name, view: current(), updatedAt: now() }],
      });
      return id;
    },
    overwrite: async (ref) => {
      if (ref.source === 'personal')
        await savePersonal({
          ...mine,
          views: mine.views.map((v) => (v.id === ref.id ? { ...v, view: current(), updatedAt: now() } : v)),
        });
      else if (ref.source === 'map')
        await changeMap((list) =>
          list.map((v) => (v.id === ref.id ? toMapView(v.id, v.name, current(), v.slot, v.updatedAt) : v)),
        );
    },
    rename: async (ref, name) => {
      if (ref.source === 'personal')
        await savePersonal({ ...mine, views: mine.views.map((v) => (v.id === ref.id ? { ...v, name } : v)) });
      else if (ref.source === 'map')
        await changeMap((list) => list.map((v) => (v.id === ref.id ? { ...v, name } : v)));
    },
    remove: async (ref) => {
      if (ref.source === 'personal')
        await savePersonal({ ...mine, views: mine.views.filter((v) => v.id !== ref.id) });
      else if (ref.source === 'map') await changeMap((list) => list.filter((v) => v.id !== ref.id));
    },
    pin: (slot, ref) =>
      savePersonal({
        ...mine,
        pins: {
          ...mine.pins,
          [mapId]: { ...mine.pins[mapId], [`${slot}`]: { source: ref.source, id: ref.id } },
        },
      }),
    resetPins: () => {
      const { [mapId]: _gone, ...pins } = mine.pins;
      return savePersonal({ ...mine, pins });
    },
    publish: (name, view, slot) =>
      changeMap((list) => [
        ...list.map((v) => (slot !== undefined && v.slot === slot ? withoutSlot(v) : v)),
        toMapView(newViewId('m'), name, view, slot, now()),
      ]),
    setMapSlot: (id, slot) =>
      changeMap((list) =>
        list.map((v) => {
          if (v.id === id) return slot === undefined ? withoutSlot(v) : { ...v, slot };
          return slot !== undefined && v.slot === slot ? withoutSlot(v) : v;
        }),
      ),
  };
}

function withoutSlot(view: MapViewDto): MapViewDto {
  const { slot: _slot, ...rest } = view;
  return rest;
}
