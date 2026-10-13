/*
 * The map widgets' windows, as Wanderer's window manager places them: separate windows over the
 * map, each with one job, dragged by their title bar, resized from their corners, kept 10 px inside
 * the map and snapped to its edges and to each other within 10 px. Pure geometry here; the windows
 * themselves are in `WidgetWindow.tsx`.
 */

/** The core widgets, in the order of the widgets menu. Plugin widgets follow them. */
export const CORE_WIDGETS = [
  { id: 'info', title: 'System info' },
  { id: 'signatures', title: 'Signatures' },
  { id: 'local', title: 'Local' },
  { id: 'routes', title: 'Routes' },
  { id: 'kills', title: 'Kills' },
  { id: 'structures', title: 'Structures' },
  { id: 'comments', title: 'Comments' },
  { id: 'connections', title: 'Connections' },
  { id: 'history', title: 'History' },
] as const;

export type CoreWidgetId = (typeof CORE_WIDGETS)[number]['id'];

/** Shown until someone chooses otherwise: Wanderer's four, and Kills. */
export const DEFAULT_VISIBLE: readonly string[] = ['info', 'signatures', 'local', 'routes', 'kills'];

/** A plugin's widget, by plugin and title (its registry key changes with the load order). */
export const pluginWidgetId = (entry: { pluginId: string; title: string }) =>
  `plugin:${entry.pluginId}:${entry.title}`;

/** Wanderer's numbers: windows stay 10 px inside the map and snap within 10 px, 10 px apart. */
export const GUTTER = 10;
export const SNAP = 10;
export const MIN_SIZE = { w: 180, h: 100 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Area {
  width: number;
  height: number;
}

/**
 * A window as kept: its distance from the nearer edges, so a window by the right or bottom edge
 * stays there on a larger or smaller screen (Wanderer moves windows whose middle is in the right or
 * bottom half with those edges).
 */
export interface StoredBox extends Box {
  right?: true;
  bottom?: true;
}

export interface WidgetsLayout {
  /** Widget ids shown; null until someone shows or hides one (then the defaults apply). */
  visible: string[] | null;
  /** Windows someone moved, resized or turned on; the rest take the default layout. */
  boxes: Record<string, StoredBox>;
  /** Back to front: the last one is on top. */
  order: string[];
}

export const EMPTY_LAYOUT: WidgetsLayout = { visible: null, boxes: {}, order: [] };

/** Kept in this browser and mirrored with my preferences like every `dbk-*` option. */
export const LAYOUT_KEY = 'dbk-map-widgets';

const isBox = (v: unknown): v is StoredBox =>
  typeof v === 'object' &&
  v !== null &&
  ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

export function isLayout(v: unknown): v is WidgetsLayout {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as WidgetsLayout;
  return (
    (l.visible === null || (Array.isArray(l.visible) && l.visible.every((id) => typeof id === 'string'))) &&
    typeof l.boxes === 'object' &&
    l.boxes !== null &&
    Object.values(l.boxes).every(isBox) &&
    Array.isArray(l.order)
  );
}

export const visibleIds = (layout: WidgetsLayout): readonly string[] => layout.visible ?? DEFAULT_VISIBLE;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The default layout for a map of this size, Wanderer's arrangement against the right edge (the
 * map's search and its zoom and legend buttons are on the left): System info over Signatures, Local
 * beside them as tall as both, Routes and Kills along the bottom. Nothing overlaps. Structures and
 * Comments get a column of their own further left; the rest find a free spot when turned on.
 */
export function defaultBoxes(area: Area): Record<string, Box> {
  const g = GUTTER;
  const { width: W, height: H } = area;
  const a = clamp(Math.round(W * 0.3), 400, 560);
  const b = clamp(Math.round(W * 0.2), 280, 340);
  const c = clamp(Math.round(W * 0.28), 380, 460);
  const xA = W - g - a;
  const xB = xA - g - b;
  const xC = xB - g - c;
  const info = 250;
  const bottomRow = clamp(Math.round(H * 0.22), 160, 240);
  const bottomY = H - g - bottomRow;
  const signatures = Math.max(140, bottomY - g - (g + info + g));
  const half = Math.max(MIN_SIZE.h, Math.floor((H - 3 * g) / 2));
  return {
    info: { x: xA, y: g, w: a, h: info },
    signatures: { x: xA, y: g + info + g, w: a, h: signatures },
    local: { x: xB, y: g, w: b, h: info + g + signatures },
    routes: { x: xA, y: bottomY, w: a, h: bottomRow },
    kills: { x: xB, y: bottomY, w: b, h: bottomRow },
    structures: { x: xC, y: g, w: c, h: half },
    comments: { x: xC, y: g + half + g, w: c, h: half },
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + GUTTER &&
  b.x < a.x + a.w + GUTTER &&
  a.y < b.y + b.h + GUTTER &&
  b.y < a.y + a.h + GUTTER;

/**
 * Where a widget turned on goes: its default spot, else the first free half-height slot from the
 * right, else cascaded from the top left.
 */
export function placeNew(id: string, area: Area, occupied: readonly Box[]): Box {
  const own = defaultBoxes(area)[id];
  if (own && !occupied.some((o) => overlaps(o, own))) return clampBox(own, area);
  const w = clamp(Math.round(area.width * 0.28), 380, 460);
  const h = Math.max(MIN_SIZE.h, Math.floor((area.height - 3 * GUTTER) / 2));
  for (let x = area.width - GUTTER - w; x >= GUTTER; x -= w + GUTTER)
    for (const y of [GUTTER, GUTTER * 2 + h]) {
      const slot = { x, y, w, h };
      if (!occupied.some((o) => overlaps(o, slot))) return clampBox(slot, area);
    }
  const step = 28 * (occupied.length % 8);
  return clampBox({ x: GUTTER * 4 + step, y: GUTTER + step, w, h }, area);
}

/** Inside the map, 10 px from its edges, never smaller than the minimum. */
export function clampBox(box: Box, area: Area): Box {
  const w = clamp(box.w, MIN_SIZE.w, area.width - 2 * GUTTER);
  const h = clamp(box.h, MIN_SIZE.h, area.height - 2 * GUTTER);
  return {
    x: Math.round(clamp(box.x, GUTTER, area.width - GUTTER - w)),
    y: Math.round(clamp(box.y, GUTTER, area.height - GUTTER - h)),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function toStored(box: Box, area: Area): StoredBox {
  const right = box.x + box.w / 2 > area.width / 2;
  const bottom = box.y + box.h / 2 > area.height / 2;
  return {
    x: right ? area.width - box.x - box.w : box.x,
    y: bottom ? area.height - box.y - box.h : box.y,
    w: box.w,
    h: box.h,
    ...(right ? { right: true as const } : {}),
    ...(bottom ? { bottom: true as const } : {}),
  };
}

export function fromStored(s: StoredBox, area: Area): Box {
  return clampBox(
    {
      x: s.right ? area.width - s.x - s.w : s.x,
      y: s.bottom ? area.height - s.y - s.h : s.y,
      w: s.w,
      h: s.h,
    },
    area,
  );
}

/** Every shown window's box on a map of this size. */
export function resolveBoxes(layout: WidgetsLayout, area: Area, ids: readonly string[]): Record<string, Box> {
  const defaults = defaultBoxes(area);
  const out: Record<string, Box> = {};
  for (const id of ids) {
    const stored = layout.boxes[id];
    if (stored) out[id] = fromStored(stored, area);
    else if (defaults[id]) out[id] = clampBox(defaults[id], area);
  }
  // Ones without a default spot (turned on before the map had a size): the first free place.
  for (const id of ids) if (!out[id]) out[id] = placeNew(id, area, Object.values(out));
  return out;
}

/** The nearest candidate within the snap distance, or null. */
function nearest(value: number, candidates: readonly number[]): number | null {
  let best: number | null = null;
  for (const c of candidates)
    if (Math.abs(c - value) <= SNAP && (best === null || Math.abs(c - value) < Math.abs(best - value)))
      best = c;
  return best;
}

/** Lines a window's edges snap to: the map's edges (10 px in) and the other windows', 10 px apart. */
function guides(area: Area, others: readonly Box[]) {
  return {
    left: [GUTTER, ...others.flatMap((o) => [o.x, o.x + o.w + GUTTER])],
    right: [area.width - GUTTER, ...others.flatMap((o) => [o.x + o.w, o.x - GUTTER])],
    top: [GUTTER, ...others.flatMap((o) => [o.y, o.y + o.h + GUTTER])],
    bottom: [area.height - GUTTER, ...others.flatMap((o) => [o.y + o.h, o.y - GUTTER])],
  };
}

/** A window dragged by (dx, dy) from where it started: kept inside, snapped to edges and windows. */
export function moveBox(start: Box, dx: number, dy: number, area: Area, others: readonly Box[]): Box {
  const box = clampBox({ ...start, x: start.x + dx, y: start.y + dy }, area);
  const g = guides(area, others);
  const left = nearest(box.x, g.left);
  const right = nearest(box.x + box.w, g.right);
  if (left !== null) box.x = left;
  else if (right !== null) box.x = right - box.w;
  const top = nearest(box.y, g.top);
  const bottom = nearest(box.y + box.h, g.bottom);
  if (top !== null) box.y = top;
  else if (bottom !== null) box.y = bottom - box.h;
  return clampBox(box, area);
}

/** Which corner a resize pulls: -1 the left or top edge, 1 the right or bottom one. */
export interface Corner {
  x: -1 | 1;
  y: -1 | 1;
}

/** A window resized from a corner by (dx, dy): the opposite corner stays, edges snap. */
export function resizeBox(
  start: Box,
  corner: Corner,
  dx: number,
  dy: number,
  area: Area,
  others: readonly Box[],
): Box {
  const g = guides(area, others);
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (corner.x === 1) {
    right = clamp(right + dx, left + MIN_SIZE.w, area.width - GUTTER);
    right = nearest(right, g.right) ?? right;
  } else {
    left = clamp(left + dx, GUTTER, right - MIN_SIZE.w);
    left = nearest(left, g.left) ?? left;
  }
  if (corner.y === 1) {
    bottom = clamp(bottom + dy, top + MIN_SIZE.h, area.height - GUTTER);
    bottom = nearest(bottom, g.bottom) ?? bottom;
  } else {
    top = clamp(top + dy, GUTTER, bottom - MIN_SIZE.h);
    top = nearest(top, g.top) ?? top;
  }
  return clampBox({ x: left, y: top, w: right - left, h: bottom - top }, area);
}

/**
 * How much of the map's right side the windows take: those against the right edge and the ones
 * side by side with them. The map fits the chain and keeps the selected system clear of it; a
 * window left elsewhere on the map does not count.
 */
export function coveredRight(boxes: readonly Box[], area: Area): number {
  let left = area.width;
  let rest = boxes.filter((b) => b.x + b.w >= area.width - 2 * GUTTER);
  if (rest.length === 0) return 0;
  const others = boxes.filter((b) => !rest.includes(b));
  while (rest.length > 0) {
    left = Math.min(left, ...rest.map((b) => b.x));
    rest = others.filter((b) => b.x < left && b.x + b.w >= left - 2 * GUTTER);
    for (const b of rest) others.splice(others.indexOf(b), 1);
  }
  const cover = area.width - left + GUTTER;
  // A column of windows, not most of the map.
  return cover > area.width * 0.75 ? 0 : cover;
}

/** Brings a window to the front; the same array when it already is. */
export function raise(order: readonly string[], id: string): string[] {
  if (order.at(-1) === id) return order as string[];
  return [...order.filter((x) => x !== id), id];
}

export function setVisible(layout: WidgetsLayout, id: string, on: boolean, place?: StoredBox): WidgetsLayout {
  const current = visibleIds(layout);
  if (current.includes(id) === on) return layout;
  const visible = on ? [...current, id] : current.filter((x) => x !== id);
  return {
    ...layout,
    visible,
    order: on ? raise(layout.order, id) : layout.order,
    // A window turned on keeps the free spot it was given, wherever the others go later.
    boxes: on && place && !layout.boxes[id] ? { ...layout.boxes, [id]: place } : layout.boxes,
  };
}

/**
 * The old sidebar's hidden sections (the `sidebar` preferences area) as widgets: the defaults minus
 * the ones someone had hidden. Null when nothing was hidden (the defaults apply as they are).
 */
export function migrateSidebarLayout(old: unknown): string[] | null {
  if (typeof old !== 'object' || old === null || !Array.isArray((old as { hidden?: unknown }).hidden))
    return null;
  const hidden = new Set(
    ((old as { hidden: unknown[] }).hidden.filter((x) => typeof x === 'string') as string[]).map((id) =>
      id === 'system' ? 'info' : id,
    ),
  );
  const visible = DEFAULT_VISIBLE.filter((id) => !hidden.has(id));
  return visible.length === DEFAULT_VISIBLE.length ? null : visible;
}
