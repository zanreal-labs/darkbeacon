import { chainTree, findSystemSpot, type Position } from '@darkbeacon/shared';
import type { Connection, MapSystem } from './map.js';

/** What is known about where a system that nobody dragged should go. */
export interface PlacementHint {
  /** The system it was reached from: a jump's origin, the selected system, a connection's other end. */
  near?: number | null;
  /** Without one: the middle of the viewer's screen (or the spot clicked), as a node's corner. */
  around?: Position | null;
  /** A hidden system's old spot. */
  previous?: Position | null;
}

/**
 * Where a system goes on a map when nobody dragged it there: the map's one placement rule
 * (`findSystemSpot`), told the chain around the system it was reached from — that system's own
 * parent, so the chain keeps growing away from home — and, without one, home or else the system
 * placed last to settle next to. Hidden systems and their connections do not count.
 */
export function placeSystem(
  systems: readonly MapSystem[],
  connections: readonly Connection[],
  hint: PlacementHint = {},
): Position {
  const visible = systems.filter((s) => s.visible);
  const shown = new Set(visible.map((s) => s.solarSystemId));
  const links = connections.filter((c) => shown.has(c.source) && shown.has(c.target));
  const parent = hint.near !== undefined && hint.near !== null && shown.has(hint.near) ? hint.near : null;
  const upstream =
    parent === null
      ? null
      : (chainTree(visible, links).steps.find((s) => s.child === parent)?.parent ?? null);
  const home = visible
    .filter((s) => s.status === 'home')
    .sort((a, b) => a.createdAt - b.createdAt || a.solarSystemId - b.solarSystemId)[0];
  const last = [...visible].sort((a, b) => b.createdAt - a.createdAt || b.solarSystemId - a.solarSystemId)[0];
  return findSystemSpot({
    nodes: visible.map((s) => ({ id: s.solarSystemId, position: s.position })),
    links,
    parent,
    upstream,
    previous: hint.previous ?? null,
    around: hint.around ?? null,
    fallback: (home ?? last)?.position ?? null,
  });
}
