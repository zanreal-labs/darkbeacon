/*
 * The map widgets' windows. The map is the product: while a system is selected its windows stand
 * in one narrow column against the right edge, each as tall as its content, stacked 8 px apart.
 * A window someone drags out of the column floats where it was left (kept 10 px inside the map,
 * snapped to its edges and to other windows within 10 px, as Wanderer's). Pure geometry here; the
 * windows themselves are in `WidgetWindow.tsx`.
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
/** The smallest a window other than the core ones gets. */
export const MIN_SIZE = { w: 260, h: 140 };

/**
 * The smallest each window gets, enough to read something: Signatures its title and about five
 * rows, System info the header and two lines of facts, Local three pilots, Routes and Kills three
 * rows. A window sized by its content never goes below it, and neither does a resize.
 */
const MIN_SIZES: Record<string, { w: number; h: number }> = {
  signatures: { w: 320, h: 180 },
  info: { w: 300, h: 110 },
  local: { w: 240, h: 130 },
  routes: { w: 280, h: 130 },
  kills: { w: 280, h: 130 },
};

export const minSize = (id: string): { w: number; h: number } => MIN_SIZES[id] ?? MIN_SIZE;

/** Docked windows stand 8 px apart in their column. */
export const DOCK_GAP = 8;

/** The column's order, top to bottom: what a pilot reads first is on top. Others follow. */
export const DOCK_ORDER: readonly string[] = ['info', 'signatures', 'local', 'routes', 'kills'];

/**
 * How much of the map's height a window sized by its content may take before its content
 * scrolls: Signatures the most, Local a quarter, the rest compact.
 */
const DOCK_SHARE: Record<string, number> = {
  info: 0.4,
  signatures: 0.45,
  local: 0.25,
  routes: 0.2,
  kills: 0.22,
};
const OTHER_SHARE = 0.25;

/**
 * Who gives way first when the column runs past the bottom: the extra widgets, Kills and Routes,
 * then Signatures (it scrolls anyway), then Local, then System info, each down to its minimum.
 */
function giveWayOrder(order: readonly string[]): number[] {
  const rank = (id: string) => {
    const i = ['kills', 'routes', 'signatures', 'local', 'info'].indexOf(id);
    return i === -1 ? -1 : i;
  };
  return order
    .map((id, i) => ({ i, rank: rank(id) }))
    .sort((a, b) => a.rank - b.rank || b.i - a.i)
    .map((x) => x.i);
}

/** Before a window was measured: about a title bar and two rows. */
const UNMEASURED = 76;

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
 * bottom half with those edges). Its height is the most it grows to; its content may be shorter.
 */
export interface StoredBox extends Box {
  right?: true;
  bottom?: true;
  /** Resized by hand: it keeps this height and its content scrolls (until fitted to content). */
  fixed?: true;
  /** Snapped under this floating window: it stays under it as that one grows, shrinks or moves. */
  below?: string;
}

/**
 * The whole arrangement of the widgets, one serializable value: what shows, which windows float
 * and where, their order, the docked windows' heights and the column's width. It is saved and
 * replaced as one (`parseLayout` reads any version kept before), so a named view of the map can
 * hold it.
 */
export interface WidgetsLayout {
  version: typeof LAYOUT_VERSION;
  /** Widget ids shown; null until someone shows or hides one (then the defaults apply). */
  visible: string[] | null;
  /** Windows someone dragged out of the column: they float there. */
  boxes: Record<string, StoredBox>;
  /** Back to front: the last one is on top. */
  order: string[];
  /** Docked windows someone resized by hand: the height each keeps, its content scrolling. */
  caps?: Record<string, number>;
  /** The column's width, when someone resized it. */
  dockWidth?: number;
}

/** 2: the docked column (1 placed every window on the map). */
export const LAYOUT_VERSION = 2;

export const EMPTY_LAYOUT: WidgetsLayout = { version: LAYOUT_VERSION, visible: null, boxes: {}, order: [] };

/** Kept in this browser and mirrored with my preferences like every `dbk-*` option. */
export const LAYOUT_KEY = 'dbk-map-widgets';

const isBox = (v: unknown): v is StoredBox =>
  typeof v === 'object' &&
  v !== null &&
  ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((v as Record<string, unknown>)[k])) &&
  ((v as StoredBox).below === undefined || typeof (v as StoredBox).below === 'string');

/** A layout of any version kept before (1 had no `version`). */
type AnyLayout = Omit<WidgetsLayout, 'version'> & { version?: number };

function isAnyLayout(v: unknown): v is AnyLayout {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as AnyLayout;
  return (
    (l.version === undefined || l.version === LAYOUT_VERSION) &&
    (l.visible === null || (Array.isArray(l.visible) && l.visible.every((id) => typeof id === 'string'))) &&
    typeof l.boxes === 'object' &&
    l.boxes !== null &&
    Object.values(l.boxes).every(isBox) &&
    Array.isArray(l.order) &&
    (l.caps === undefined ||
      (typeof l.caps === 'object' && l.caps !== null && Object.values(l.caps).every(Number.isFinite))) &&
    (l.dockWidth === undefined || Number.isFinite(l.dockWidth))
  );
}

export const isLayout = (v: unknown): v is WidgetsLayout =>
  isAnyLayout(v) && (v as AnyLayout).version === LAYOUT_VERSION;

/**
 * A kept layout as this version reads it, or null when it is not one. Version 1 placed every
 * window across the map with fixed heights: its choice of widgets and their order stay, and the
 * windows go back to the column.
 */
export function parseLayout(v: unknown): WidgetsLayout | null {
  if (!isAnyLayout(v)) return null;
  if (v.version === LAYOUT_VERSION) return v as WidgetsLayout;
  return { version: LAYOUT_VERSION, visible: v.visible, boxes: {}, order: v.order };
}

export const visibleIds = (layout: WidgetsLayout): readonly string[] => layout.visible ?? DEFAULT_VISIBLE;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The column's width: about 360 px, 320-400, never more than 30% of the map. */
export function dockWidth(area: Area, chosen?: number): number {
  const most = Math.round(area.width * 0.3);
  const width = chosen ?? clamp(Math.round(area.width * 0.25), 320, 400);
  return Math.round(Math.max(MIN_SIZE.w, Math.min(width, most, area.width - 2 * GUTTER)));
}

/** The order docked windows stack in. */
export function dockOrder(ids: readonly string[]): string[] {
  const rank = (id: string) => {
    const i = DOCK_ORDER.indexOf(id);
    return i === -1 ? DOCK_ORDER.length + ids.indexOf(id) : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** The most a window sized by its content grows to before its content scrolls: its share of the map. */
export function dockCap(id: string, area: Area): number {
  return Math.max(minSize(id).h, Math.round(area.height * (DOCK_SHARE[id] ?? OTHER_SHARE)));
}

/**
 * A window's height: the one someone gave it by hand (`fixed`), else its content's, up to its
 * share of the map; never below its minimum.
 */
export function windowHeight(id: string, area: Area, natural: number | undefined, fixed?: number): number {
  const least = minSize(id).h;
  if (fixed !== undefined) return Math.round(Math.max(least, fixed));
  return Math.round(Math.max(least, Math.min(natural ?? UNMEASURED, dockCap(id, area))));
}

/**
 * The stretches of the column's height free of floating windows that stand over it (8 px clear of
 * each): the docked windows stack in them and never end up under a floating one.
 */
function freeRanges(area: Area, over: readonly Box[]): Array<[number, number]> {
  const bottom = area.height - GUTTER;
  const blocked = over
    .map((b): [number, number] => [b.y - DOCK_GAP, b.y + b.h + DOCK_GAP])
    .sort((a, b) => a[0] - b[0]);
  const ranges: Array<[number, number]> = [];
  let from = GUTTER;
  for (const [start, end] of blocked) {
    if (start > from) ranges.push([from, Math.min(start, bottom)]);
    from = Math.max(from, end);
  }
  if (from < bottom) ranges.push([from, bottom]);
  const usable = ranges.filter(([a, b]) => b - a > 0);
  return usable.length > 0 ? usable : [[Math.min(from, bottom), bottom]];
}

/**
 * The docked column against the right edge: each window as tall as its content (`natural`), up to
 * its share of the map, or the height someone gave it by hand (`fixed`), stacked 8 px apart from
 * the top and around any floating window that stands over the column, so none is ever hidden
 * under one. When they do not fit, Kills and Routes give way first, then Signatures, Local and
 * System info last, each down to its minimum, and their content scrolls; windows sized by hand
 * keep their height.
 */
export function dockColumn(
  ids: readonly string[],
  area: Area,
  natural: Readonly<Record<string, number | undefined>>,
  fixed: Readonly<Record<string, number>> = {},
  width?: number,
  floating: readonly Box[] = [],
): Record<string, Box> {
  const order = dockOrder(ids);
  const widest = Math.max(0, ...order.map((id) => minSize(id).w));
  const w = Math.round(Math.min(Math.max(dockWidth(area, width), widest), area.width - 2 * GUTTER));
  const x = area.width - GUTTER - w;
  const over = floating.filter((b) => b.x < x + w && b.x + b.w > x);
  const ranges = freeRanges(area, over);
  const heights = order.map((id) => windowHeight(id, area, natural[id], fixed[id]));
  /** Each window at the next free place, past a floating window when it does not fit above it. */
  const stack = () => {
    const out: Record<string, Box> = {};
    let r = 0;
    let y = ranges[0]![0];
    order.forEach((id, i) => {
      const h = heights[i]!;
      while (r < ranges.length - 1 && y + h > ranges[r]![1]) {
        r += 1;
        y = ranges[r]![0];
      }
      out[id] = { x, y, w, h };
      y += h + DOCK_GAP;
    });
    return out;
  };
  // Past the bottom: the windows give way by what is missing, and stack again (a shorter window
  // may now fit above a floating one).
  let out = stack();
  for (let pass = 0; pass < order.length + 1; pass++) {
    const last = order.length > 0 ? out[order.at(-1)!]! : null;
    let excess = last ? last.y + last.h - (area.height - GUTTER) : 0;
    if (excess <= 0) break;
    let gave = 0;
    for (const i of giveWayOrder(order)) {
      if (excess <= 0) break;
      const id = order[i]!;
      if (fixed[id] !== undefined) continue;
      const give = Math.max(0, Math.min(excess, heights[i]! - minSize(id).h));
      heights[i] = heights[i]! - give;
      excess -= give;
      gave += give;
    }
    if (gave === 0) break;
    out = stack();
  }
  return out;
}

/** Inside the map, 10 px from its edges, never smaller than the minimum. */
export function clampBox(box: Box, area: Area, least: { w: number; h: number } = MIN_SIZE): Box {
  const w = clamp(box.w, least.w, area.width - 2 * GUTTER);
  const h = clamp(box.h, least.h, area.height - 2 * GUTTER);
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

export function fromStored(s: StoredBox, area: Area, least: { w: number; h: number } = MIN_SIZE): Box {
  return clampBox(
    {
      x: s.right ? area.width - s.x - s.w : s.x,
      y: s.bottom ? area.height - s.y - s.h : s.y,
      w: s.w,
      h: s.h,
    },
    area,
    least,
  );
}

export interface Resolved {
  boxes: Record<string, Box>;
  /** The windows in the column (never dragged out); the rest float where they were left. */
  docked: ReadonlySet<string>;
  /** The column's width with its gutters and how far down it reaches; null without one. */
  column: { width: number; bottom: number } | null;
}

/**
 * Every shown window's box on a map of this size, from the heights the windows' content measures
 * now: the floating ones where they were left (one snapped under another stays under it), as tall
 * as their content or the height they were given by hand, then the docked column around them.
 */
export function resolveBoxes(
  layout: WidgetsLayout,
  area: Area,
  ids: readonly string[],
  natural: Readonly<Record<string, number | undefined>> = {},
): Resolved {
  const floatingIds = ids.filter((id) => layout.boxes[id]);
  const docked = ids.filter((id) => !layout.boxes[id]);
  const base: Record<string, Box> = {};
  for (const id of floatingIds) {
    const stored = layout.boxes[id]!;
    const least = minSize(id);
    const h = windowHeight(id, area, natural[id], stored.fixed ? stored.h : undefined);
    base[id] = fromStored({ ...stored, h }, area, least);
  }
  const boxes: Record<string, Box> = {};
  const placing = new Set<string>();
  const place = (id: string): Box => {
    const done = boxes[id];
    if (done) return done;
    let box = base[id]!;
    const parent = layout.boxes[id]!.below;
    if (parent && base[parent] && !placing.has(parent)) {
      placing.add(id);
      const above = place(parent);
      placing.delete(id);
      const least = minSize(id).h;
      const y = above.y + above.h + GUTTER;
      // Kept inside the map: near the bottom it gets shorter and its content scrolls.
      const room = area.height - GUTTER - y;
      box =
        room >= least
          ? { ...box, y, h: Math.min(box.h, room) }
          : { ...box, y: area.height - GUTTER - least, h: least };
    }
    boxes[id] = box;
    return box;
  };
  for (const id of floatingIds) place(id);
  const column = dockColumn(
    docked,
    area,
    natural,
    layout.caps,
    layout.dockWidth,
    floatingIds.map((id) => boxes[id]!),
  );
  Object.assign(boxes, column);
  const lowest = Object.values(column).reduce<Box | null>(
    (low, b) => (low === null || b.y + b.h > low.y + low.h ? b : low),
    null,
  );
  return {
    boxes,
    docked: new Set(docked),
    column: lowest
      ? { width: lowest.w + 2 * GUTTER, bottom: Math.min(area.height, lowest.y + lowest.h + GUTTER) }
      : null,
  };
}

/**
 * The floating window a box was dropped right under (its top 10 px below that window's bottom,
 * overlapping it sideways), which it then stays under; never one that is itself under this one.
 */
export function snappedUnder(
  id: string,
  box: Box,
  floating: Readonly<Record<string, Box>>,
  layout: WidgetsLayout,
): string | undefined {
  const underThis = (other: string) => {
    const seen = new Set<string>();
    for (let at: string | undefined = other; at && !seen.has(at); at = layout.boxes[at]?.below) {
      if (at === id) return true;
      seen.add(at);
    }
    return false;
  };
  for (const [other, b] of Object.entries(floating)) {
    if (other === id || underThis(other)) continue;
    if (Math.abs(b.y + b.h + GUTTER - box.y) > 1) continue;
    if (b.x < box.x + box.w && b.x + b.w > box.x) return other;
  }
  return undefined;
}

/**
 * Keeps a floating window where it was moved or resized to. A resize by hand fixes its height
 * (its content scrolls from then on); a move keeps whatever it had. `below`: the floating window
 * it was dropped right under.
 */
export function placeFloating(
  layout: WidgetsLayout,
  id: string,
  box: Box,
  area: Area,
  how: { resized?: boolean; below?: string | undefined } = {},
): WidgetsLayout {
  const fixed = how.resized || layout.boxes[id]?.fixed;
  const stored: StoredBox = {
    ...toStored(box, area),
    ...(fixed ? { fixed: true as const } : {}),
    ...(how.below ? { below: how.below } : {}),
  };
  return { ...layout, boxes: { ...layout.boxes, [id]: stored }, order: raise(layout.order, id) };
}

/** Back to its content's height (a double-click on a resize corner); every window without an id. */
export function fitToContent(layout: WidgetsLayout, id?: string): WidgetsLayout {
  const fits = (key: string) => id === undefined || key === id;
  const caps = Object.fromEntries(Object.entries(layout.caps ?? {}).filter(([key]) => !fits(key)));
  const boxes = Object.fromEntries(
    Object.entries(layout.boxes).map(([key, b]): [string, StoredBox] => {
      if (!fits(key) || !b.fixed) return [key, b];
      const { fixed: _fixed, ...rest } = b;
      return [key, rest];
    }),
  );
  const { caps: _caps, ...rest } = layout;
  return { ...rest, boxes, ...(Object.keys(caps).length > 0 ? { caps } : {}) };
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
export function moveBox(
  start: Box,
  dx: number,
  dy: number,
  area: Area,
  others: readonly Box[],
  least: { w: number; h: number } = MIN_SIZE,
): Box {
  const box = clampBox({ ...start, x: start.x + dx, y: start.y + dy }, area, least);
  const g = guides(area, others);
  const left = nearest(box.x, g.left);
  const right = nearest(box.x + box.w, g.right);
  if (left !== null) box.x = left;
  else if (right !== null) box.x = right - box.w;
  const top = nearest(box.y, g.top);
  const bottom = nearest(box.y + box.h, g.bottom);
  if (top !== null) box.y = top;
  else if (bottom !== null) box.y = bottom - box.h;
  return clampBox(box, area, least);
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
  least: { w: number; h: number } = MIN_SIZE,
): Box {
  const g = guides(area, others);
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (corner.x === 1) {
    right = clamp(right + dx, left + least.w, area.width - GUTTER);
    right = nearest(right, g.right) ?? right;
  } else {
    left = clamp(left + dx, GUTTER, right - least.w);
    left = nearest(left, g.left) ?? left;
  }
  if (corner.y === 1) {
    bottom = clamp(bottom + dy, top + least.h, area.height - GUTTER);
    bottom = nearest(bottom, g.bottom) ?? bottom;
  } else {
    top = clamp(top + dy, GUTTER, bottom - least.h);
    top = nearest(top, g.top) ?? top;
  }
  return clampBox({ x: left, y: top, w: right - left, h: bottom - top }, area, least);
}

/** Brings a window to the front; the same array when it already is. */
export function raise(order: readonly string[], id: string): string[] {
  if (order.at(-1) === id) return order as string[];
  return [...order.filter((x) => x !== id), id];
}

/** Shows or hides a widget; one turned on joins the column. */
export function setVisible(layout: WidgetsLayout, id: string, on: boolean): WidgetsLayout {
  const current = visibleIds(layout);
  if (current.includes(id) === on) return layout;
  const visible = on ? [...current, id] : current.filter((x) => x !== id);
  return { ...layout, visible, order: on ? raise(layout.order, id) : layout.order };
}

/** A docked window resized by hand: it keeps that height (its content scrolls), its width the column's. */
export function resizeDocked(layout: WidgetsLayout, id: string, box: Box, area: Area): WidgetsLayout {
  const width = dockWidth(area);
  return {
    ...layout,
    caps: { ...layout.caps, [id]: Math.round(box.h) },
    ...(Math.abs(box.w - dockWidth(area, layout.dockWidth)) >= 1
      ? box.w === width
        ? { dockWidth: undefined }
        : { dockWidth: Math.round(box.w) }
      : {}),
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
