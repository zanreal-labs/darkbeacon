import type { Position } from '@darkbeacon/shared';

/**
 * Room a Darkbeacon system needs on the canvas (a node is about 240 by 100 px with its bookmark
 * tag, see `SYSTEM_PLACEMENT`); Wanderer draws smaller nodes, so its layouts are tighter.
 */
export const NODE_ROOM = { width: 260, height: 125 } as const;
const MAX_SCALE = 3;

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
    positions: positions.map((p) => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale) })),
    scale,
  };
}
