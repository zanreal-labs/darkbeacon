import type { RouteNode, RoutePolicy } from './modes.js';

export type EdgeKind = 'gate' | 'wormhole' | 'bridge';

/** A two-way link the chain (or a plugin, such as jump bridges) adds to the stargate graph. */
export interface ExtraEdge {
  a: number;
  b: number;
  via: Exclude<EdgeKind, 'gate'>;
  /** The map connection it stands for, if any. */
  connectionId: string | null;
  /** Where an edge that is no map connection comes from: a jump bridge list or EVE-Scout. */
  origin?: EdgeOrigin;
}

export type EdgeOrigin = 'ansiblex' | 'eve-scout';

interface Link {
  to: number;
  via: EdgeKind;
  connectionId: string | null;
  origin?: EdgeOrigin;
}

/** Every known system and its stargates, indexed once (the universe does not change at runtime). */
export class StargateGraph {
  readonly nodes: RouteNode[] = [];
  readonly index = new Map<number, number>();
  readonly gates: number[][] = [];

  constructor(nodes: Iterable<RouteNode>, gatesOf: (id: number) => readonly number[]) {
    for (const node of nodes) {
      this.index.set(node.id, this.nodes.length);
      this.nodes.push(node);
    }
    for (const node of this.nodes) {
      this.gates.push(
        gatesOf(node.id)
          .map((id) => this.index.get(id))
          .filter((i): i is number => i !== undefined),
      );
    }
  }

  get size(): number {
    return this.nodes.length;
  }
}

/** The stargate graph plus extra two-way edges (a map's chain). */
export class RouteGraph {
  private readonly extra = new Map<number, Link[]>();

  constructor(
    readonly base: StargateGraph,
    edges: readonly ExtraEdge[] = [],
  ) {
    for (const edge of edges) {
      const a = base.index.get(edge.a);
      const b = base.index.get(edge.b);
      if (a === undefined || b === undefined || a === b) continue;
      const origin = edge.origin ? { origin: edge.origin } : {};
      this.link(a, { to: b, via: edge.via, connectionId: edge.connectionId, ...origin });
      this.link(b, { to: a, via: edge.via, connectionId: edge.connectionId, ...origin });
    }
  }

  node(id: number): RouteNode | null {
    const i = this.base.index.get(id);
    return i === undefined ? null : this.base.nodes[i]!;
  }

  *links(i: number): Generator<Link> {
    for (const to of this.base.gates[i]!) yield { to, via: 'gate', connectionId: null };
    yield* this.extra.get(i) ?? [];
  }

  private link(from: number, link: Link): void {
    const list = this.extra.get(from) ?? [];
    // A chain connection between gate neighbours (a gate on the map) adds nothing, nor does a
    // second link between the same two systems (a bridge drawn on the map and also imported).
    if (link.via !== 'gate' && this.base.gates[from]!.includes(link.to)) return;
    if (list.some((l) => l.to === link.to)) return;
    list.push(link);
    this.extra.set(from, list);
  }
}

/** Min-heap of [cost, hops, node] ordered by cost, then hops. */
class Heap {
  private readonly items: Array<[number, number, number]> = [];

  get size(): number {
    return this.items.length;
  }

  push(item: [number, number, number]): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): [number, number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

const less = (x: [number, number, number], y: [number, number, number]) =>
  x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

/** Systems a route may not enter (the avoid list); the start is always allowed. */
export type Blocked = ReadonlySet<number>;

/** Zarzakh, the Deathless capital reached by stargates from Turnur, Alsavoinon, G-0Q86 and H-PA29. */
export const ZARZAKH = 30100000;

/**
 * Systems a route may start or end in but never pass through. Entering Zarzakh by a stargate
 * locks a ship to the gate it came through for a while (the Emanation Lock), so it is no
 * shortcut between its neighbours: the game's own autopilot never routes through it either.
 */
export const NO_TRANSIT: ReadonlySet<number> = new Set([ZARZAKH]);

/**
 * Jumps from every system to `targetId` under `policy` (-1 where there is no route). Runs Dijkstra
 * backwards from the target: entering a system costs what the policy says, and a system the
 * policy forbids can still be the start of a route but never a step on the way.
 */
export function jumpsTo(
  graph: RouteGraph,
  targetId: number,
  policy: RoutePolicy,
  blocked: Blocked = new Set(),
): Int16Array {
  const n = graph.base.size;
  const hops = new Int16Array(n).fill(-1);
  const target = graph.base.index.get(targetId);
  if (target === undefined) return hops;
  const enterable = (i: number) => {
    const node = graph.base.nodes[i]!;
    return policy.allows(node) && !blocked.has(node.id);
  };
  if (!enterable(target)) {
    hops[target] = 0;
    return hops;
  }
  const cost = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  cost[target] = 0;
  hops[target] = 0;
  const heap = new Heap();
  heap.push([0, 0, target]);
  while (heap.size > 0) {
    const [c, h, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    // Only systems a route may pass through lead further back.
    if (u !== target && (!enterable(u) || NO_TRANSIT.has(graph.base.nodes[u]!.id))) continue;
    const step = policy.cost(graph.base.nodes[u]!);
    for (const { to: v } of graph.links(u)) {
      const next = c + step;
      if (next < cost[v]! || (next === cost[v] && h + 1 < hops[v]!)) {
        cost[v] = next;
        hops[v] = h + 1;
        heap.push([next, h + 1, v]);
      }
    }
  }
  return hops;
}

export interface RouteStep {
  id: number;
  via: 'start' | EdgeKind;
  connectionId: string | null;
  origin?: EdgeOrigin;
}

/** The cheapest route from `fromId` to `toId` under `policy`, or null when there is none. */
export function findRoute(
  graph: RouteGraph,
  fromId: number,
  toId: number,
  policy: RoutePolicy,
  blocked: Blocked = new Set(),
): RouteStep[] | null {
  const from = graph.base.index.get(fromId);
  const to = graph.base.index.get(toId);
  if (from === undefined || to === undefined) return null;
  if (from === to) return [{ id: fromId, via: 'start', connectionId: null }];
  const n = graph.base.size;
  const cost = new Float64Array(n).fill(Infinity);
  const hops = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const prevLink: PrevLink = new Array(n);
  const done = new Uint8Array(n);
  cost[from] = 0;
  hops[from] = 0;
  const heap = new Heap();
  heap.push([0, 0, from]);
  while (heap.size > 0) {
    const [c, h, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    if (u !== from && NO_TRANSIT.has(graph.base.nodes[u]!.id)) continue;
    for (const link of graph.links(u)) {
      const v = link.to;
      const node = graph.base.nodes[v]!;
      if (!policy.allows(node) || blocked.has(node.id)) continue;
      const next = c + policy.cost(node);
      if (next < cost[v]! || (next === cost[v] && h + 1 < hops[v]!)) {
        cost[v] = next;
        hops[v] = h + 1;
        prev[v] = u;
        prevLink[v] = link;
        heap.push([next, h + 1, v]);
      }
    }
  }
  if (!done[to]) return null;
  return walkBack(graph, from, to, prev, prevLink);
}

type PrevLink = Array<{ via: EdgeKind; connectionId: string | null; origin?: EdgeOrigin } | undefined>;

function walkBack(graph: RouteGraph, from: number, to: number, prev: Int32Array, prevLink: PrevLink) {
  const steps: RouteStep[] = [];
  for (let i = to; i !== from; i = prev[i]!) {
    const link = prevLink[i]!;
    steps.push({
      id: graph.base.nodes[i]!.id,
      via: link.via,
      connectionId: link.connectionId,
      ...(link.origin ? { origin: link.origin } : {}),
    });
  }
  steps.push({ id: graph.base.nodes[from]!.id, via: 'start', connectionId: null });
  return steps.reverse();
}

/** The cheapest routes from one system to every other, as `routesFrom` returns them. */
export interface RouteTree {
  /** The cheapest route to `toId`, or null when there is none. */
  to(toId: number): RouteStep[] | null;
}

/**
 * The cheapest route under `policy` from `fromId` to every system at once (one Dijkstra run, the
 * same costs and tie-break as `findRoute`): for the routes to many hubs from one system.
 */
export function routesFrom(graph: RouteGraph, fromId: number, policy: RoutePolicy): RouteTree {
  const from = graph.base.index.get(fromId);
  if (from === undefined) return { to: () => null };
  const n = graph.base.size;
  const cost = new Float64Array(n).fill(Infinity);
  const hops = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const prevLink: PrevLink = new Array(n);
  const done = new Uint8Array(n);
  cost[from] = 0;
  hops[from] = 0;
  const heap = new Heap();
  heap.push([0, 0, from]);
  while (heap.size > 0) {
    const [c, h, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u !== from && NO_TRANSIT.has(graph.base.nodes[u]!.id)) continue;
    for (const link of graph.links(u)) {
      const v = link.to;
      const node = graph.base.nodes[v]!;
      if (!policy.allows(node)) continue;
      const next = c + policy.cost(node);
      if (next < cost[v]! || (next === cost[v] && h + 1 < hops[v]!)) {
        cost[v] = next;
        hops[v] = h + 1;
        prev[v] = u;
        prevLink[v] = link;
        heap.push([next, h + 1, v]);
      }
    }
  }
  return {
    to(toId) {
      const to = graph.base.index.get(toId);
      if (to === undefined || !done[to]) return null;
      return walkBack(graph, from, to, prev, prevLink);
    },
  };
}
