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
