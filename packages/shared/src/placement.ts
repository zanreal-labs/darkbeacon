import { MAP_GRID, SYSTEM_PLACEMENT, onMapGrid } from './dto/bookmarks.js';
import type { Position } from './dto/mapping.js';

/**
 * What a system node covers on the canvas, from its position (the box's top-left corner): the
 * 240 by 70 px box, the chip row above it (Labels, bookmark, Tags) and the one below it (hub,
 * sovereignty), 30 px each.
 */
export const SYSTEM_FOOTPRINT = { left: 0, top: -30, width: 240, height: 130 } as const;

/** The node's own box, without the chip rows: what a connection must not run through. */
export const SYSTEM_BOX = { left: 0, top: 0, width: 240, height: 70 } as const;

/** The middle of a system node's box, from its position: where its connections aim. */
export const SYSTEM_NODE_CENTRE = { x: 120, y: 35 } as const;
/** Kept clear around every footprint, so two nodes never touch (stacked rows leave 14 px). */
const CLEARANCE = { x: MAP_GRID / 2, y: 6 };
/** How far an old spot may be from the system a restored one is reached from, and still count. */
const NEAR = { x: 2 * SYSTEM_PLACEMENT.x, y: 3 * SYSTEM_PLACEMENT.y };

/** Rings (or rows) searched at most; a map runs out of systems long before. */
const SEARCH_LIMIT = 1000;

// Costs, in rows of distance: a slot a row further away costs 1.
/** A row above the preferred one (siblings stack downwards). */
const ABOVE = 1.5;
/** A column away from the preferred one, when looking around a spot without a parent. */
const COLUMN = 1.2;
/** The new node would sit on an existing connection. */
const ON_EDGE = 4;
/** An existing connection would only run over the new node's label row or chips. */
const ON_CHIPS = 1;
/** The new connection would run through another node's box. */
const THROUGH_NODE = 4;
/** The new connection would cross an existing one. */
const CROSSING = 3;

export interface PlacementNode {
  id: number;
  position: Position;
}

export interface PlacementLink {
  source: number;
  target: number;
}

/** Where a new (or restored) system should go, and what it may go next to. */
export interface SpotRequest {
  /** Systems shown on the map. */
  nodes: readonly PlacementNode[];
  /** Connections between them. */
  links: readonly PlacementLink[];
  /** The system it was reached from (its parent in the chain), when on the map. */
  parent?: number | null;
  /** The parent's own parent in the chain: the chain grows away from it. */
  upstream?: number | null;
  /** A restored system's old spot: kept when free and still near its parent (or the chain). */
  previous?: Position | null;
  /** Without a parent: where the viewer looks (or clicked), as a node's corner. */
  around?: Position | null;
  /** Without a parent or `around`: a system to place it next to (home, or the last placed). */
  fallback?: Position | null;
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Segment {
  a: Position;
  b: Position;
  ends: [number, number];
}

type Area = { left: number; top: number; width: number; height: number };

const rect = (p: Position, area: Area, pad = { x: 0, y: 0 }): Rect => ({
  l: p.x + area.left - pad.x,
  t: p.y + area.top - pad.y,
  r: p.x + area.left + area.width + pad.x,
  b: p.y + area.top + area.height + pad.y,
});
const footprint = (p: Position, pad?: Position): Rect => rect(p, SYSTEM_FOOTPRINT, pad);

const centre = (p: Position): Position => ({ x: p.x + SYSTEM_NODE_CENTRE.x, y: p.y + SYSTEM_NODE_CENTRE.y });

const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/** Whether the segment a-b passes through the inside of `r` (Liang-Barsky clipping). */
export function segmentHitsRect(a: Position, b: Position, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - r.l],
    [dx, r.r - a.x],
    [-dy, a.y - r.t],
    [dy, r.b - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

/** Whether two segments cross each other (touching ends do not count). */
export function segmentsCross(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const side = (a: Position, b: Position, c: Position) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The map as the placement sees it: node footprints and connection lines. */
class Board {
  private readonly at = new Map<number, Position>();
  private readonly blocked: Rect[];
  private readonly segments: Segment[] = [];

  constructor(nodes: readonly PlacementNode[], links: readonly PlacementLink[]) {
    for (const n of nodes) this.at.set(n.id, n.position);
    this.blocked = nodes.map((n) => footprint(n.position, CLEARANCE));
    for (const l of links) {
      const a = this.at.get(l.source);
      const b = this.at.get(l.target);
      if (a && b) this.segments.push({ a: centre(a), b: centre(b), ends: [l.source, l.target] });
    }
  }

  position(id: number | null | undefined): Position | null {
    return id === null || id === undefined ? null : (this.at.get(id) ?? null);
  }

  neighbours(id: number): number[] {
    return this.segments.flatMap((s) =>
      s.ends[0] === id ? [s.ends[1]] : s.ends[1] === id ? [s.ends[0]] : [],
    );
  }

  get empty(): boolean {
    return this.at.size === 0;
  }

  /** No other node's footprint (with the clearance) is in the way. */
  free(p: Position): boolean {
    const own = footprint(p, CLEARANCE);
    return !this.blocked.some((r) => overlaps(own, r));
  }

  /** What is wrong with a node at `p` linked to `parent`: edges under it, its edge over others. */
  penalty(p: Position, parent: number | null): number {
    let cost = 0;
    const own = footprint(p);
    const box = rect(p, SYSTEM_BOX);
    for (const s of this.segments) {
      if (segmentHitsRect(s.a, s.b, box)) cost += ON_EDGE;
      else if (segmentHitsRect(s.a, s.b, own)) cost += ON_CHIPS;
    }
    const from = this.position(parent);
    if (from === null) return cost;
    const a = centre(from);
    const b = centre(p);
    // Its siblings are exempt: links fanning out to a column of them graze each other's corners.
    const siblings = new Set(this.neighbours(parent!));
    for (const [id, q] of this.at) {
      if (id === parent || siblings.has(id)) continue;
      if (segmentHitsRect(a, b, rect(q, SYSTEM_BOX))) cost += THROUGH_NODE;
    }
    for (const s of this.segments) {
      if (s.ends.includes(parent!)) continue;
      if (segmentsCross(a, b, s.a, s.b)) cost += CROSSING;
    }
    return cost;
  }
}

/**
 * `p` moved onto the rows and columns of the system nearest to it (on the grid when the map is
 * empty), so a system added in the middle of the screen lines up with the chain around it.
 */
function inLine(p: Position, nodes: readonly PlacementNode[]): Position {
  let closest: Position | null = null;
  for (const { position: q } of nodes) {
    if (!closest || Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(closest.x - p.x, closest.y - p.y))
      closest = q;
  }
  if (!closest) return onMapGrid(p);
  const step = (v: number, from: number, size: number) => from + Math.round((v - from) / size) * size;
  return onMapGrid({
    x: step(p.x, closest.x, SYSTEM_PLACEMENT.x),
    y: step(p.y, closest.y, SYSTEM_PLACEMENT.y),
  });
}

const near = (a: Position, b: Position) => Math.abs(a.x - b.x) <= NEAR.x && Math.abs(a.y - b.y) <= NEAR.y;

/** In the column one step left or right of `parent` (where the rule puts its children). */
const besideColumn = (spot: Position, parent: Position) =>
  Math.abs(Math.abs(spot.x - parent.x) - SYSTEM_PLACEMENT.x) < SYSTEM_PLACEMENT.x / 2;

/**
 * Where a system goes that nobody dragged, the way mappers lay a chain out by hand (see
 * docs/decisions.md, "One placement rule"). Never on another node (label row and chips included),
 * on the map grid, and preferably neither on a connection nor with its own connection crossing or
 * running under anything:
 *
 * - a restored system goes back to its old spot when that is free and in a column next to its
 *   parent, within a few rows (or, without a parent, near the chain);
 * - with a parent: one column further in the chain's growth direction (right unless the chain grows
 *   left), in the parent's row, or under the parent's children already in that column; when that
 *   slot is taken, the nearest free one below, then above, in that column;
 * - without one: the free slot nearest `around` (the middle of the viewer's screen), in line with
 *   the rows and columns of the system nearest to it, else next to `fallback` (home, or the last
 *   system placed), below it first; on an empty map, `around` or 0,0.
 */
export function findSystemSpot(request: SpotRequest): Position {
  const board = new Board(request.nodes, request.links);
  const parentAt = board.position(request.parent);
  const parent = parentAt ? request.parent! : null;

  const previous = request.previous;
  if (previous) {
    // With a parent, only where the rule itself could have put it: in a column next to the
    // parent, within a few rows (never above it in its own column, nor columns away).
    const stillNear = parentAt
      ? besideColumn(previous, parentAt) && near(previous, parentAt)
      : request.around
        ? near(previous, request.around)
        : board.empty || request.nodes.some((n) => near(previous, n.position));
    if (stillNear && board.free(previous) && board.penalty(previous, parent) === 0) return previous;
  }

  if (parentAt) return besideParent(board, parent!, parentAt, request.upstream ?? null);
  if (request.around) return nearest(board, inLine(request.around, request.nodes));
  if (request.fallback) return nearest(board, onMapGrid(request.fallback));
  return nearest(board, { x: 0, y: 0 });
}

function besideParent(board: Board, parent: number, at: Position, upstream: number | null): Position {
  const up = board.position(upstream);
  const neighbours = board.neighbours(parent).filter((id) => id !== upstream);
  let direction = 1;
  if (up) direction = up.x > at.x ? -1 : 1;
  else {
    const sides = board.neighbours(parent).map((id) => board.position(id)!.x - at.x);
    if (sides.length > 0 && sides.every((dx) => dx < 0)) direction = -1;
  }
  const column = onMapGrid({ x: at.x + direction * SYSTEM_PLACEMENT.x, y: 0 }).x;
  // Siblings: the parent's other children stacked in that column from its row down; the new one
  // goes under them. One that strayed far below is no stack to join.
  const start = onMapGrid(at).y;
  const stacked = neighbours
    .map((id) => board.position(id)!)
    .filter((p) => Math.abs(p.x - column) < SYSTEM_PLACEMENT.x / 2 && p.y >= start - NEAR.y)
    .map((p) => p.y)
    .sort((a, b) => a - b);
  let bottom: number | null = null;
  for (const y of stacked) {
    if (y > (bottom ?? start) + 2 * SYSTEM_PLACEMENT.y) break;
    bottom = y;
  }
  const row = bottom === null ? start : onMapGrid({ x: 0, y: bottom + SYSTEM_PLACEMENT.y }).y;

  const best = new Cheapest();
  for (let reach = 0; reach < SEARCH_LIMIT && !best.beats(reach); reach++) {
    for (const step of reach === 0 ? [0] : [reach, -reach]) {
      const spot = { x: column, y: row + step * SYSTEM_PLACEMENT.y };
      if (board.free(spot))
        best.offer(spot, (step >= 0 ? step : -step * ABOVE) + board.penalty(spot, parent));
    }
  }
  return best.spot ?? { x: column, y: row };
}

/** The free slot nearest `origin` on a lattice of system steps, below it first. */
function nearest(board: Board, origin: Position): Position {
  const best = new Cheapest();
  for (let reach = 0; reach < SEARCH_LIMIT && !best.beats(reach); reach++) {
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== reach) continue;
        const spot = { x: origin.x + i * SYSTEM_PLACEMENT.x, y: origin.y + j * SYSTEM_PLACEMENT.y };
        if (!board.free(spot)) continue;
        best.offer(spot, Math.abs(i) * COLUMN + (j >= 0 ? j : -j * ABOVE) + board.penalty(spot, null));
      }
    }
  }
  return best.spot ?? origin;
}

/** The cheapest free slot offered so far; the first one wins a tie (offered nearest first). */
class Cheapest {
  spot: Position | null = null;
  private cost = Infinity;

  offer(spot: Position, cost: number): void {
    if (cost < this.cost) {
      this.spot = spot;
      this.cost = cost;
    }
  }

  /** Whether nothing costing at least `bound` can beat it: every slot of ring `bound` costs that much. */
  beats(bound: number): boolean {
    return this.cost <= bound;
  }
}

/** A system for `strayRepairs`: home systems root the chain. */
export interface ChainNode extends PlacementNode {
  home?: boolean;
}

/**
 * Whether `spot` is far off where the rule puts a child of the system at `parent`: more than two
 * columns aside, more than three rows above, or more than three rows below the stack of its
 * `children` (all the parent's children, so a column of siblings never counts as far).
 */
export function strayedFrom(spot: Position, parent: Position, children = 1): boolean {
  const below = NEAR.y + Math.max(0, children - 1) * SYSTEM_PLACEMENT.y;
  const dy = spot.y - parent.y;
  return Math.abs(spot.x - parent.x) > NEAR.x || dy < -NEAR.y || dy > below;
}

const farness = (spot: Position, parent: Position) =>
  Math.abs(spot.x - parent.x) / SYSTEM_PLACEMENT.x + Math.abs(spot.y - parent.y) / SYSTEM_PLACEMENT.y;

/**
 * Systems that stand far off the system they hang off (`strayedFrom`), moved back by the rule
 * (`findSystemSpot`) beside it, as a map heals itself: a spot left from an old layout, a source's
 * coordinates, a sibling stacked under one of those. The chain is walked from its roots (homes
 * first, then `nodes` in order; `links` in order decide which system another hangs off), so a
 * moved system's children follow it. Roots and systems in `keep` (locked, or put there by hand)
 * stay; a move happens only where it lands nearer. Returns the new spots.
 */
export function strayRepairs(
  nodes: readonly ChainNode[],
  links: readonly PlacementLink[],
  keep: ReadonlySet<number> = new Set(),
): Map<number, Position> {
  const at = new Map(nodes.map((n) => [n.id, n.position]));
  const adjacent = new Map<number, number[]>();
  const shown = links.filter((l) => at.has(l.source) && at.has(l.target) && l.source !== l.target);
  for (const l of shown) {
    adjacent.set(l.source, [...(adjacent.get(l.source) ?? []), l.target]);
    adjacent.set(l.target, [...(adjacent.get(l.target) ?? []), l.source]);
  }
  const parentOf = new Map<number, number>();
  const children = new Map<number, number>();
  const order: number[] = [];
  const seen = new Set<number>();
  for (const root of [...nodes.filter((n) => n.home), ...nodes]) {
    if (seen.has(root.id)) continue;
    seen.add(root.id);
    const queue = [root.id];
    for (let q = 0; q < queue.length; q++) {
      const id = queue[q]!;
      for (const next of adjacent.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        parentOf.set(next, id);
        children.set(id, (children.get(id) ?? 0) + 1);
        order.push(next);
        queue.push(next);
      }
    }
  }

  const strays = (id: number) => {
    const parent = parentOf.get(id)!;
    return !keep.has(id) && strayedFrom(at.get(id)!, at.get(parent)!, children.get(parent) ?? 1);
  };
  // Strayed systems not moved yet stand nowhere: neither they nor their lines block a slot.
  const waiting = new Set(order.filter(strays));
  const moved = new Map<number, Position>();
  for (const id of order) {
    if (!strays(id)) {
      waiting.delete(id);
      continue;
    }
    waiting.add(id);
    const parent = parentOf.get(id)!;
    const parentAt = at.get(parent)!;
    const spot = at.get(id)!;
    const count = children.get(parent) ?? 1;
    const out = (n: number) => waiting.has(n);
    const next = findSystemSpot({
      nodes: [...at].filter(([n]) => !out(n)).map(([n, position]) => ({ id: n, position })),
      links: shown.filter((l) => !out(l.source) && !out(l.target)),
      parent,
      upstream: parentOf.get(parent) ?? null,
    });
    waiting.delete(id);
    if (strayedFrom(next, parentAt, count) && farness(next, parentAt) >= farness(spot, parentAt)) continue;
    at.set(id, next);
    moved.set(id, next);
  }
  return moved;
}
