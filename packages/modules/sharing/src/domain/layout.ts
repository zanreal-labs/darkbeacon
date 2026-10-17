import {
  findSystemSpot,
  MAP_GRID,
  SYSTEM_PLACEMENT,
  type PlacementLink,
  type Position,
} from '@darkbeacon/shared';

/**
 * Where a system new to a merged map goes, by the map placement rule (`findSystemSpot`): where its
 * source has it (`hint`, or beside a neighbour at the source's offset) when that spot is free,
 * else next to `near` (a neighbour already placed) like any new system, else as near the hint as
 * it is free, else below the system placed last. `placed` is in placing order.
 */
export function placeFree(
  hint: Position | null,
  placed: ReadonlyMap<number, Position>,
  links: readonly PlacementLink[] = [],
  near: number | null = null,
): Position {
  const nodes = [...placed].map(([id, position]) => ({ id, position }));
  return findSystemSpot({
    nodes,
    links,
    parent: near,
    previous: hint,
    around: hint,
    fallback: nodes.at(-1)?.position ?? null,
  });
}

/** The connections between systems placed on a merged map's layout, by their neighbours. */
export function layoutLinks(
  placed: ReadonlyMap<number, Position>,
  neighbours: (solarSystemId: number) => readonly number[],
): PlacementLink[] {
  return [...placed.keys()].flatMap((id) =>
    neighbours(id)
      .filter((n) => n > id && placed.has(n))
      .map((n) => ({ source: id, target: n })),
  );
}

/** A position from a source's own layout, if the value is one. */
export function asPosition(value: unknown): Position | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

/**
 * Where a system goes next to a neighbour already on the merged map: as far from it as the source
 * holding both has it. Sources lay themselves out differently, so only offsets within one source
 * mean something.
 */
export function besideNeighbour(
  own: Position,
  neighbourInSource: Position,
  neighbourPlaced: Position,
): Position {
  return {
    x: neighbourPlaced.x + own.x - neighbourInSource.x,
    y: neighbourPlaced.y + own.y - neighbourInSource.y,
  };
}

/** The corners of a group of systems: from the top-left one to the bottom-right one. */
export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function extentOf(points: Iterable<Position>): Extent | null {
  let extent: Extent | null = null;
  for (const p of points) {
    if (!extent) extent = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      extent.minX = Math.min(extent.minX, p.x);
      extent.minY = Math.min(extent.minY, p.y);
      extent.maxX = Math.max(extent.maxX, p.x);
      extent.maxY = Math.max(extent.maxY, p.y);
    }
  }
  return extent;
}

const onGridUp = (v: number) => Math.ceil(v / MAP_GRID) * MAP_GRID;

/**
 * Where a source's cluster goes on a merged map: sources lay themselves out in coordinate spaces
 * of their own, so a cluster is shifted to sit right of what the map already shows (`taken`),
 * one empty column between them and its top on theirs, by a shift on the map grid. The first
 * cluster (nothing taken yet) keeps its own coordinates.
 */
export function clusterOffset(cluster: Extent | null, taken: Extent | null): Position {
  if (!cluster || !taken) return { x: 0, y: 0 };
  return {
    x: onGridUp(taken.maxX + 2 * SYSTEM_PLACEMENT.x - cluster.minX),
    y: onGridUp(taken.minY - cluster.minY),
  };
}

export const shifted = (p: Position, by: Position): Position => ({ x: p.x + by.x, y: p.y + by.y });

/**
 * A system a merged map placed where its source has it, before sources had offsets: at its
 * source position, or moved straight down from it past systems it would have covered
 * (`placeFree`). Anything else was moved there by someone.
 */
export function placedAsSourceHasIt(placed: Position, own: Position): boolean {
  const down = placed.y - own.y;
  return placed.x === own.x && down >= 0 && down % SYSTEM_PLACEMENT.y === 0;
}
