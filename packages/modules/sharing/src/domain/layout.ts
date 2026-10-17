import { findSystemSpot, type PlacementLink, type Position } from '@darkbeacon/shared';

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
