export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** A side of a system card, named as React Flow names its handle positions. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** How far apart two cards may be sideways and still count as one above the other. */
export const STACKED_SLACK = 10;

/**
 * The side of `rect` a connection to `other` leaves from, as Wanderer picks it: the top or bottom
 * when the two cards overlap sideways (give or take `STACKED_SLACK`), else the left or right, so
 * a tree laid out left to right joins parents and children side to side.
 */
export function sideTowards(rect: Rect, other: Rect): Side {
  const stacked =
    rect.x - STACKED_SLACK <= other.x + other.width && other.x <= rect.x + rect.width + STACKED_SLACK;
  const a = center(rect);
  const b = center(other);
  if (stacked) return a.y > b.y ? 'top' : 'bottom';
  return a.x > b.x ? 'left' : 'right';
}

/** The middle of one side of a rectangle. */
export function sideMiddle(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

/** Where a connection between two cards starts and ends: the middles of the sides facing each other. */
export function sideEnds(
  source: Rect,
  target: Rect,
): { from: Point; to: Point; fromSide: Side; toSide: Side } {
  const fromSide = sideTowards(source, target);
  const toSide = sideTowards(target, source);
  return { from: sideMiddle(source, fromSide), to: sideMiddle(target, toSide), fromSide, toSide };
}

/** A point `distance` along the segment from `a` to `b`. */
export function along(a: Point, b: Point, distance: number): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.min(1, distance / length);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The viewport that shows `bounds` inside `screen` minus `padding`, zoomed between `minZoom` and
 * `maxZoom`. When the content only fits below `minZoom`, it stays at `minZoom` centred on `anchor`
 * (the home system, say) or else on the middle of the content, so systems stay readable.
 */
export function fitViewport(
  bounds: Rect,
  screen: { width: number; height: number },
  padding: Padding,
  { minZoom, maxZoom, anchor }: { minZoom: number; maxZoom: number; anchor?: Point },
): Viewport {
  const width = Math.max(1, screen.width - padding.left - padding.right);
  const height = Math.max(1, screen.height - padding.top - padding.bottom);
  const fits = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
  const zoom = Math.min(maxZoom, Math.max(minZoom, fits));
  const focus = fits < minZoom && anchor ? anchor : center(bounds);
  return {
    x: padding.left + width / 2 - focus.x * zoom,
    y: padding.top + height / 2 - focus.y * zoom,
    zoom,
  };
}

/** Smallest rectangle around all `rects`; null for none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
