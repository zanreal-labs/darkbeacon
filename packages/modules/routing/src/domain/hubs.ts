import type { StargateGraph } from './graph.js';
import { isWormholeSpace, type RouteNode, type RoutePolicy } from './modes.js';

/** The five trade hubs every viewer gets distances to. */
export const TRADE_HUBS: ReadonlyArray<{ solarSystemId: number; name: string }> = [
  { solarSystemId: 30000142, name: 'Jita' },
  { solarSystemId: 30002187, name: 'Amarr' },
  { solarSystemId: 30002659, name: 'Dodixie' },
  { solarSystemId: 30002510, name: 'Rens' },
  { solarSystemId: 30002053, name: 'Hek' },
];

/** At most this many hubs per map and per account. */
export const MAX_HUBS = 20;

/** Low-sec known space: a staging system for pilots who cannot enter high-sec. */
export function isLowSec(node: RouteNode): boolean {
  return !isWormholeSpace(node) && node.security > 0 && node.security < 0.45;
}

/**
 * The systems a policy allows that are linked to each other by stargates without leaving what it
 * allows, largest group only: known space an outlaw can roam without entering high-sec, rather
 * than a low-sec pocket only reachable through high-sec.
 */
export function largestAllowedRegion(graph: StargateGraph, policy: RoutePolicy): Set<number> {
  const seen = new Uint8Array(graph.size);
  let best: number[] = [];
  for (let start = 0; start < graph.size; start++) {
    if (seen[start] || !policy.allows(graph.nodes[start]!) || graph.gates[start]!.length === 0) continue;
    const group = [start];
    seen[start] = 1;
    for (let k = 0; k < group.length; k++) {
      for (const j of graph.gates[group[k]!]!) {
        if (seen[j] || !policy.allows(graph.nodes[j]!)) continue;
        seen[j] = 1;
        group.push(j);
      }
    }
    if (group.length > best.length) best = group;
  }
  return new Set(best.map((i) => graph.nodes[i]!.id));
}

/**
 * The system nearest to `hubId` over stargates that the policy lets a route end in and that
 * `wanted` accepts; among equally near ones the first by name. Null when there is none.
 */
export function nearestStaging(
  graph: StargateGraph,
  hubId: number,
  policy: RoutePolicy,
  wanted: (node: RouteNode) => boolean,
  nameOf: (id: number) => string,
): RouteNode | null {
  const start = graph.index.get(hubId);
  if (start === undefined) return null;
  const seen = new Uint8Array(graph.size);
  seen[start] = 1;
  let layer = [start];
  while (layer.length > 0) {
    const found = layer
      .map((i) => graph.nodes[i]!)
      .filter((node) => policy.allows(node) && wanted(node))
      .sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id)));
    if (found.length > 0) return found[0]!;
    const next: number[] = [];
    for (const i of layer) {
      for (const j of graph.gates[i]!) {
        if (seen[j]) continue;
        seen[j] = 1;
        next.push(j);
      }
    }
    layer = next;
  }
  return null;
}
