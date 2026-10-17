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

/** Where the line from the centre of `rect` towards `to` leaves the rectangle. */
export function borderPoint(rect: Rect, to: Point): Point {
  const c = center(rect);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(
    dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy),
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** End points of a straight connection drawn between the borders of two nodes. */
export function floatingEnds(source: Rect, target: Rect): { from: Point; to: Point } {
  return { from: borderPoint(source, center(target)), to: borderPoint(target, center(source)) };
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
