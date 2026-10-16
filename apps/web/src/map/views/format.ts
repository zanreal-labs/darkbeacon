/*
 * Saved views of the map screen (pure): what a view holds, reading one of any version kept before,
 * the three built-in ones, which view each quick slot shows, and whether the screen still looks
 * like a view. The widget layout is `WidgetsLayout` (`../widgets/layout`), the canvas options are
 * the ones of `../canvas/prefs` that change what the screen looks like.
 */
import {
  MapViewDto,
  VIEW_FORMAT_VERSION,
  VIEW_SLOTS,
  ViewCanvasDto,
  type ViewSlot,
} from '@darkbeacon/shared';
import type { CanvasPrefs } from '../canvas/prefs';
import { EMPTY_LAYOUT, parseLayout, type WidgetsLayout } from '../widgets/layout';

/** The canvas options a view carries: where the minimap and the rally card sit, the background. */
export const VIEW_CANVAS_KEYS = ['minimap', 'pings', 'background', 'softBackground'] as const;
export type ViewCanvas = Partial<Pick<CanvasPrefs, (typeof VIEW_CANVAS_KEYS)[number]>>;

/** What a view puts on the screen (the shared `ViewPresetDto`, read into this version's terms). */
export interface ViewPreset {
  version: typeof VIEW_FORMAT_VERSION;
  layout: WidgetsLayout;
  canvas: ViewCanvas;
}

/** Where a view comes from: my own, the map's (published by a manager), or built in. */
export type ViewSource = 'personal' | 'map' | 'builtin';

export interface ViewRef {
  source: ViewSource;
  id: string;
}

/** A view as the switcher lists it. */
export interface NamedView extends ViewRef {
  name: string;
  view: ViewPreset;
  /** A map view's slot for everyone. */
  slot?: ViewSlot;
}

/** One of my own views (my preferences, `views` area). */
export interface PersonalView {
  id: string;
  name: string;
  view: ViewPreset;
  updatedAt: number;
}

/** My views and, per map, the views I pinned to the quick slots over the map's defaults. */
export interface PersonalViews {
  version: 1;
  views: PersonalView[];
  pins: Record<string, Partial<Record<`${ViewSlot}`, ViewRef>>>;
}

/** The preferences area holding them. */
export const VIEWS_AREA = 'views';
export const EMPTY_PERSONAL: PersonalViews = { version: 1, views: [], pins: {} };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The screen as it is now, as a view. */
export function captureView(layout: WidgetsLayout, prefs: CanvasPrefs): ViewPreset {
  const canvas: ViewCanvas = {};
  for (const key of VIEW_CANVAS_KEYS) (canvas as Record<string, unknown>)[key] = prefs[key];
  return { version: VIEW_FORMAT_VERSION, layout: parseLayout(layout) ?? EMPTY_LAYOUT, canvas };
}

/**
 * A kept view as this version reads it, or null when it is none: a newer format is refused, the
 * layout is read like any kept layout (older ones come back to the column), and canvas options
 * this version does not know, or invalid ones, are left out.
 */
export function parseView(raw: unknown): ViewPreset | null {
  if (!isRecord(raw) || raw.version !== VIEW_FORMAT_VERSION) return null;
  const layout = parseLayout(raw.layout);
  if (!layout) return null;
  const canvas: ViewCanvas = {};
  if (isRecord(raw.canvas))
    for (const key of VIEW_CANVAS_KEYS) {
      const one = ViewCanvasDto.shape[key].safeParse(raw.canvas[key]);
      if (one.success && one.data !== undefined) (canvas as Record<string, unknown>)[key] = one.data;
    }
  return { version: VIEW_FORMAT_VERSION, layout, canvas };
}

/** My views from the preferences area; anything unreadable is left out. */
export function parsePersonalViews(raw: unknown): PersonalViews {
  if (!isRecord(raw) || raw.version !== 1) return EMPTY_PERSONAL;
  const views: PersonalView[] = [];
  for (const v of Array.isArray(raw.views) ? raw.views : []) {
    if (!isRecord(v) || typeof v.id !== 'string' || typeof v.name !== 'string') continue;
    const view = parseView(v.view);
    if (view) views.push({ id: v.id, name: v.name, view, updatedAt: Number(v.updatedAt) || 0 });
  }
  const pins: PersonalViews['pins'] = {};
  if (isRecord(raw.pins))
    for (const [mapId, slots] of Object.entries(raw.pins)) {
      if (!isRecord(slots)) continue;
      const kept: Partial<Record<`${ViewSlot}`, ViewRef>> = {};
      for (const slot of VIEW_SLOTS) {
        const ref = slots[String(slot)];
        if (isRecord(ref) && isSource(ref.source) && typeof ref.id === 'string')
          kept[`${slot}`] = { source: ref.source, id: ref.id };
      }
      if (Object.keys(kept).length > 0) pins[mapId] = kept;
    }
  return { version: 1, views, pins };
}

const isSource = (v: unknown): v is ViewSource => v === 'personal' || v === 'map' || v === 'builtin';

/** The map's published views that this version reads. */
export function mapViews(list: readonly MapViewDto[] | undefined): NamedView[] {
  return (list ?? []).flatMap((v) => {
    const view = parseView(v.view);
    return view
      ? [{ source: 'map' as const, id: v.id, name: v.name, view, ...(v.slot ? { slot: v.slot } : {}) }]
      : [];
  });
}

const builtIn = (id: string, name: string, layout: Omit<WidgetsLayout, 'version' | 'boxes' | 'order'>) => ({
  source: 'builtin' as const,
  id,
  name,
  view: {
    version: VIEW_FORMAT_VERSION,
    layout: { ...EMPTY_LAYOUT, ...layout },
    canvas: {},
  } satisfies ViewPreset,
});

/**
 * The quick slots' views on a map that has published none of its own, so they work from the first
 * sign-in: 1 for scanning (Signatures large, Routes for where the holes lead), 2 for a fight (System info's kill intel, a
 * large Local, Kills, Comments), 3 for rolling a hole (Connections with their mass and passages, Local).
 */
export const BUILT_IN_VIEWS: readonly NamedView[] = [
  builtIn('scan', 'Scan', {
    visible: ['info', 'signatures', 'routes'],
    caps: { signatures: 440 },
    dockWidth: 400,
  }),
  // A fight: Local is the main window, the comments at the bottom with room for a few of them.
  builtIn('pvp', 'PvP', {
    visible: ['info', 'local', 'kills', 'comments'],
    caps: { local: 360, comments: 200 },
    dockWidth: 400,
  }),
  builtIn('roll', 'Roll', { visible: ['info', 'connections', 'local'] }),
];

/** What a quick slot shows, and why. */
export interface SlotView {
  slot: ViewSlot;
  view: NamedView;
  /** Pinned by me over the map's default. */
  pinned: boolean;
}

/**
 * Each quick slot's view: the one I pinned there on this map, else the map's default for the
 * slot, else the built-in one. A pin to a view that is gone falls back the same way.
 */
export function resolveSlots(
  mapId: string,
  personal: PersonalViews,
  published: readonly NamedView[],
): SlotView[] {
  const pins = personal.pins[mapId] ?? {};
  return VIEW_SLOTS.map((slot, i) => {
    const pin = pins[`${slot}`];
    const pinned = pin ? findView(pin, personal, published) : null;
    if (pinned) return { slot, view: pinned, pinned: true };
    const fallback = published.find((v) => v.slot === slot) ?? BUILT_IN_VIEWS[i]!;
    return { slot, view: fallback, pinned: false };
  });
}

/** A view by where it comes from and its id; null when it is gone. */
export function findView(
  ref: ViewRef,
  personal: PersonalViews,
  published: readonly NamedView[],
): NamedView | null {
  if (ref.source === 'builtin') return BUILT_IN_VIEWS.find((v) => v.id === ref.id) ?? null;
  if (ref.source === 'map') return published.find((v) => v.id === ref.id) ?? null;
  const own = personal.views.find((v) => v.id === ref.id);
  return own ? { source: 'personal', id: own.id, name: own.name, view: own.view } : null;
}

/** JSON with sorted keys, so two values compare the same whatever order their keys came in. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isRecord(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}

/**
 * The screen still looks like the view: the same widgets in the same places and sizes and the
 * canvas options it sets. Which window is in front does not count.
 */
export function showsView(view: ViewPreset, layout: WidgetsLayout, prefs: CanvasPrefs): boolean {
  const shape = (l: WidgetsLayout) => {
    const { order: _order, ...rest } = l;
    return stable({ ...rest, caps: rest.caps ?? {}, dockWidth: rest.dockWidth ?? null });
  };
  if (shape(view.layout) !== shape(parseLayout(layout) ?? EMPTY_LAYOUT)) return false;
  return VIEW_CANVAS_KEYS.every((key) => view.canvas[key] === undefined || view.canvas[key] === prefs[key]);
}

/** The view as the map's published list keeps it. */
export function toMapView(
  id: string,
  name: string,
  view: ViewPreset,
  slot: ViewSlot | undefined,
  updatedAt: number,
): MapViewDto {
  return MapViewDto.parse({ id, name, view, updatedAt, ...(slot ? { slot } : {}) });
}

/** A new id for a view. */
export const newViewId = (prefix: 'p' | 'm') =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
