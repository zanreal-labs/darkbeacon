import { chainTree, SYSTEM_PLACEMENT } from './dto/bookmarks.js';
import type { ConnectionDto, MapSystemDto, Position } from './dto/mapping.js';
import { findSystemSpot } from './placement.js';

/** Wormhole space (J-space, Thera, the Drifter systems): solar system ids 31000000 to 31999999. */
export function inWormholeSpace(solarSystemId: number): boolean {
  return solarSystemId >= 31_000_000 && solarSystemId < 32_000_000;
}

export interface ChainSystem {
  solarSystemId: number;
  status?: string;
}

export interface ChainLink {
  source: number;
  target: number;
  type: string;
}

/**
 * The systems on the wormhole chain: walked over wormhole connections from every home and every
 * system in wormhole space, taking in the known-space systems those wormholes lead out to (the
 * exits) but going on from a known-space system only through a wormhole back into wormhole space.
 * An exit keeps the systems one stargate on (where the way out leads), nothing further. Jump bridge
 * connections are not followed, nor wormhole connections between two known-space systems away
 * from home: those are trips through known space (a cyno, a titan or black ops bridge, an
 * Ansiblex, gates), not the chain. A home in known space is a root as well and may lead out over
 * any wormhole connection.
 */
export function wormholeChain(
  systems: readonly ChainSystem[],
  connections: readonly ChainLink[],
): Set<number> {
  const present = new Set(systems.map((s) => s.solarSystemId));
  const homes = new Set(systems.filter((s) => s.status === 'home').map((s) => s.solarSystemId));
  const links = new Map<number, number[]>();
  const gates = new Map<number, number[]>();
  for (const c of connections) {
    if (!present.has(c.source) || !present.has(c.target)) continue;
    const into = c.type === 'wormhole' ? links : c.type === 'gate' ? gates : null;
    if (!into) continue;
    into.set(c.source, [...(into.get(c.source) ?? []), c.target]);
    into.set(c.target, [...(into.get(c.target) ?? []), c.source]);
  }
  const chain = new Set<number>();
  const queue: number[] = [];
  for (const s of systems) {
    if (homes.has(s.solarSystemId) || inWormholeSpace(s.solarSystemId)) {
      chain.add(s.solarSystemId);
      queue.push(s.solarSystemId);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    const fromKnownSpace = !inWormholeSpace(at) && !homes.has(at);
    for (const next of links.get(at) ?? []) {
      if (chain.has(next)) continue;
      if (fromKnownSpace && !inWormholeSpace(next)) continue;
      chain.add(next);
      queue.push(next);
    }
  }
  // One stargate on from every exit (a known-space system the chain reached).
  for (const at of [...chain]) {
    if (inWormholeSpace(at)) continue;
    for (const next of gates.get(at) ?? []) chain.add(next);
  }
  return chain;
}

/**
 * The chain laid out afresh: every root (home first, see `chainTree`) and every system in `fixed`
 * where it is, then each system, breadth first, beside the one it hangs off by the map's placement
 * rule (`findSystemSpot`), among the systems already laid out only. A root after the first that
 * is not fixed starts a group of its own right of everything laid out so far, so separate chains
 * read as separate groups.
 */
export function layOutChain(
  systems: readonly MapSystemDto[],
  connections: readonly ConnectionDto[],
  fixed: ReadonlySet<number> = new Set(),
): Map<number, Position> {
  const { roots, steps } = chainTree(systems, connections);
  const byId = new Map(systems.map((s) => [s.solarSystemId, s]));
  const placed = new Map<number, Position>();
  for (const s of systems) if (fixed.has(s.solarSystemId)) placed.set(s.solarSystemId, s.position);
  const parentOf = new Map(steps.map((s) => [s.child, s.parent]));
  const childrenOf = new Map<number, typeof steps>();
  for (const step of steps) childrenOf.set(step.parent, [...(childrenOf.get(step.parent) ?? []), step]);
  const place = (id: number, parent: number | null, start: Position | null) => {
    if (placed.has(id)) return;
    const nodes = [...placed].map(([n, position]) => ({ id: n, position }));
    const links = connections.filter((c) => placed.has(c.source) && placed.has(c.target));
    placed.set(
      id,
      parent === null
        ? findSystemSpot({ nodes, links, previous: start, around: start })
        : findSystemSpot({ nodes, links, parent, upstream: parentOf.get(parent) ?? null }),
    );
  };
  roots.forEach((root, i) => {
    // The first root keeps its spot; the others open a group right of what is laid out.
    const start = i === 0 ? byId.get(root)!.position : groupStart(placed);
    place(root, null, start);
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
      for (const step of childrenOf.get(queue[q]!) ?? []) {
        place(step.child, step.parent, null);
        queue.push(step.child);
      }
    }
  });
  return placed;
}

/** Where a new group of systems starts: two columns right of everything placed, at its top. */
export function groupStart(placed: ReadonlyMap<number, Position>): Position {
  if (placed.size === 0) return { x: 0, y: 0 };
  let maxX = -Infinity;
  let minY = Infinity;
  for (const p of placed.values()) {
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
  }
  return { x: maxX + 2 * SYSTEM_PLACEMENT.x, y: minY };
}
