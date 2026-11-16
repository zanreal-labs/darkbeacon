import { SYSTEM_PLACEMENT } from './dto/bookmarks.js';
import type { ConnectionDto, MapSystemDto, Position } from './dto/mapping.js';
import { layOutTree } from './placement.js';

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
 * The chain laid out afresh as a tree (`layOutTree`): systems in the order they were added, home
 * first, connections in the order they were made. The first root and every system in `fixed`
 * stay where they are; a further chain opens a group of its own right of everything laid out.
 */
export function layOutChain(
  systems: readonly MapSystemDto[],
  connections: readonly ConnectionDto[],
  fixed: ReadonlySet<number> = new Set(),
): Map<number, Position> {
  const visible = [...systems]
    .filter((s) => s.visible)
    .sort((a, b) => a.createdAt - b.createdAt || a.solarSystemId - b.solarSystemId);
  const links = [...connections].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return layOutTree(
    visible.map((s) => ({ id: s.solarSystemId, position: s.position, home: s.status === 'home' })),
    links.map((c) => ({ source: c.source, target: c.target })),
    fixed,
  );
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
