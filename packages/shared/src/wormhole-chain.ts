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
 * Stargate and jump bridge connections are not followed, nor wormhole connections between two
 * known-space systems away from home: those are trips through known space (a cyno, a titan or
 * black ops bridge, an Ansiblex, gates), not the chain. A home in known space is a root as well
 * and may lead out over any wormhole connection.
 */
export function wormholeChain(
  systems: readonly ChainSystem[],
  connections: readonly ChainLink[],
): Set<number> {
  const present = new Set(systems.map((s) => s.solarSystemId));
  const homes = new Set(systems.filter((s) => s.status === 'home').map((s) => s.solarSystemId));
  const links = new Map<number, number[]>();
  for (const c of connections) {
    if (c.type !== 'wormhole' || !present.has(c.source) || !present.has(c.target)) continue;
    links.set(c.source, [...(links.get(c.source) ?? []), c.target]);
    links.set(c.target, [...(links.get(c.target) ?? []), c.source]);
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
  return chain;
}
