import { MAP_GRID, SYSTEM_PLACEMENT, type Position } from '@darkbeacon/shared';

/**
 * Room a Darkbeacon system needs on the canvas, measured in the web app's default theme. Every node
 * is 240 px wide (10 cells of the 24 px grid) and 70 px tall, with a row of chips above it (Labels,
 * bookmark code, Tags) and one below (nearest hub, sovereignty). The room is the node plus 120 px of
 * visible connection across, and the node with both chip rows plus a gap down: 15 by 6 grid cells.
 * Wanderer draws 130 px nodes on a grid of about 180 x 75 px, so its layouts are tighter. It is the
 * step the map placement rule takes between systems (`SYSTEM_PLACEMENT`), so imported chains and
 * systems placed later share one spacing.
 */
export const NODE_ROOM = { width: SYSTEM_PLACEMENT.x, height: SYSTEM_PLACEMENT.y } as const;
const MAX_SCALE = 3;
/** The map's grid (`MAP_GRID`): imported systems land on it, so they line up. */
export const GRID = MAP_GRID;
const onGrid = (v: number) => Math.round(v / GRID) * GRID;

/** A Wanderer position spread by `factor`, on the map's grid. */
export function placeOnGrid(p: Position, factor: number): Position {
  return { x: onGrid(p.x * factor), y: onGrid(p.y * factor) };
}

/**
 * Spreads a layout just enough that no two systems overlap at Darkbeacon's node size, keeping
 * its shape: one scale factor for both axes (at least 1, at most 3), around the origin, so the
 * same Wanderer position always lands on the same spot (a later pull moves nothing that did not
 * move). Returns the factor so the report can say what happened.
 */
export function spreadLayout(positions: ReadonlyArray<Position>): { positions: Position[]; scale: number } {
  if (positions.length === 0) return { positions: [], scale: 1 };
  let scale = 1;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = Math.abs(positions[i]!.x - positions[j]!.x);
      const dy = Math.abs(positions[i]!.y - positions[j]!.y);
      if (dx >= NODE_ROOM.width * scale || dy >= NODE_ROOM.height * scale) continue;
      // Separating them on either axis is enough; take the cheaper one.
      const needed = Math.min(
        dx === 0 ? Infinity : NODE_ROOM.width / dx,
        dy === 0 ? Infinity : NODE_ROOM.height / dy,
      );
      if (Number.isFinite(needed)) scale = Math.max(scale, needed);
    }
  }
  scale = Math.min(MAX_SCALE, Math.round(scale * 100) / 100);
  return {
    positions: positions.map((p) => placeOnGrid(p, scale)),
    scale,
  };
}
