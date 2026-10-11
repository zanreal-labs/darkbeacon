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

const NODE_BOX = { width: 200, height: 72 };

/** Nudges a new system down until it does not cover another one. */
export function freeSpot(at: Point, taken: Point[]): Point {
  const spot = { x: Math.round(at.x), y: Math.round(at.y) };
  while (
    taken.some((p) => Math.abs(p.x - spot.x) < NODE_BOX.width && Math.abs(p.y - spot.y) < NODE_BOX.height)
  ) {
    spot.y += NODE_BOX.height + 16;
  }
  return spot;
}
