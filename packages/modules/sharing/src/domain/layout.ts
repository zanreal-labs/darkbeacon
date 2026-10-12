import { SYSTEM_PLACEMENT, type Position } from '@darkbeacon/shared';

/** Room a system node takes: a spot closer than this to another system covers it. */
const GAP = { x: SYSTEM_PLACEMENT.x - 40, y: SYSTEM_PLACEMENT.y - 10 };

function covers(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) < GAP.x && Math.abs(a.y - b.y) < GAP.y;
}

/**
 * Where a system new to a merged map goes: where its first source has it (`hint`), else right of
 * everything placed, moved down until it covers no other system.
 */
export function placeFree(hint: Position | null, taken: readonly Position[]): Position {
  let spot: Position;
  if (hint) spot = { x: hint.x, y: hint.y };
  else if (taken.length === 0) spot = { x: 0, y: 0 };
  else {
    const right = taken.reduce((best, p) => (p.x > best.x ? p : best));
    spot = { x: right.x + SYSTEM_PLACEMENT.x, y: right.y };
  }
  while (taken.some((p) => covers(p, spot))) spot = { x: spot.x, y: spot.y + SYSTEM_PLACEMENT.y };
  return spot;
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
