import type { ConnectionDto, RouteMode, RouteSkip } from '@darkbeacon/shared';
import { RouteGraph, StargateGraph, jumpsTo, type ExtraEdge } from '../domain/graph.js';
import { largestAllowedRegion, nearestStaging } from '../domain/hubs.js';
import { policyFor, type RouteNode, type RoutePolicy } from '../domain/modes.js';
import type { ChainSource, RouteEdgeSource, RoutingUniverse } from '../ports/index.js';

/** A chain connection the router may use, with what route options filter on. */
export interface ChainEdge extends ExtraEdge {
  connection: Pick<ConnectionDto, 'timeStatus' | 'massStatus' | 'shipSize'>;
}

interface MapRoutes {
  /** Visible systems and usable connections of the chain, plus plugin edges. */
  chain: Promise<{
    visible: Set<number>;
    edges: ChainEdge[];
    extra: ExtraEdge[];
    connections: ConnectionDto[];
  } | null>;
  graph?: Promise<RouteGraph | null>;
  /** policy key -> hub system id -> jumps from every system (by graph index). */
  tables: Map<string, Map<number, Int16Array>>;
  /** Results derived from this state (exits), dropped with it. */
  memo?: Map<string, Promise<unknown>>;
}

/** Maps whose routing data is kept; the least recently used one goes first. */
const MAX_MAPS = 64;

/**
 * The route engine's state: the stargate graph (built once), and per map the chain overlay and
 * cached jump tables towards hubs, one per route policy. `invalidate` drops a map's state after
 * any change to its systems or connections; tables are then rebuilt on demand.
 */
export class Router {
  private stargates: StargateGraph | undefined;
  private readonly maps = new Map<string, MapRoutes>();
  private readonly staging = new Map<string, RouteNode | null>();
  private readonly regions = new Map<string, Set<number>>();
  private readonly edgeSources: RouteEdgeSource[] = [];

  constructor(private readonly deps: { universe: RoutingUniverse; chains: ChainSource }) {}

  /** Adds a source of extra edges (jump bridges); every map's state is rebuilt. */
  addEdgeSource(source: RouteEdgeSource): void {
    this.edgeSources.push(source);
    this.maps.clear();
  }

  /** The stargate graph of the whole universe. */
  get base(): StargateGraph {
    this.stargates ??= new StargateGraph(
      [...this.deps.universe.systems()].map((s) => ({ id: s.id, security: s.security, whClass: s.whClass })),
      (id) => this.deps.universe.gateNeighbours(id),
    );
    return this.stargates;
  }

  invalidate(mapId: string): void {
    this.maps.delete(mapId);
  }

  /**
   * `compute` once per state of the map's chain: the result is kept until the chain changes
   * (`invalidate`) or `forgetDerived` drops it (what it depends on besides the chain changed).
   */
  derived<T>(mapId: string, key: string, compute: () => Promise<T>): Promise<T> {
    const state = this.state(mapId);
    const memo = (state.memo ??= new Map());
    let value = memo.get(key) as Promise<T> | undefined;
    if (!value) {
      const computing = compute();
      memo.set(key, computing);
      // A failure is not kept.
      computing.catch(() => memo.get(key) === computing && memo.delete(key));
      value = computing;
    }
    return value;
  }

  /** Drops what `derived` keeps for a map (its hubs changed), keeping the route tables. */
  forgetDerived(mapId: string): void {
    this.maps.get(mapId)?.memo?.clear();
  }

  /** The chain of a map as the router sees it; null when the map does not exist. */
  chain(mapId: string): MapRoutes['chain'] {
    return this.state(mapId).chain;
  }

  /** Stargates plus the whole chain (no options applied). */
  graph(mapId: string): Promise<RouteGraph | null> {
    const state = this.state(mapId);
    state.graph ??= state.chain.then((chain) =>
      chain ? new RouteGraph(this.base, [...chain.edges, ...chain.extra]) : null,
    );
    return state.graph;
  }

  /** Stargates plus the chain without the connections `skip` rules out. */
  async graphWith(mapId: string, skip: readonly RouteSkip[]): Promise<RouteGraph | null> {
    if (skip.length === 0) return this.graph(mapId);
    const chain = await this.chain(mapId);
    if (!chain) return null;
    const usable = chain.edges.filter(({ connection: c }) => {
      if (skip.includes('eol') && c.timeStatus === 'eol') return false;
      if (skip.includes('critical') && c.massStatus === 'critical') return false;
      if (skip.includes('frigate') && c.shipSize === 'small') return false;
      return true;
    });
    return new RouteGraph(this.base, [...usable, ...chain.extra]);
  }

  /** Jumps from every system to a hub under a policy, cached until the map changes. */
  async jumpsTo(
    mapId: string,
    hubId: number,
    policy: RoutePolicy,
  ): Promise<{ graph: RouteGraph; jumps: Int16Array } | null> {
    const state = this.state(mapId);
    const graph = await this.graph(mapId);
    if (!graph) return null;
    let table = state.tables.get(policy.key);
    if (!table) state.tables.set(policy.key, (table = new Map()));
    let jumps = table.get(hubId);
    if (!jumps) {
      // A search over the whole universe takes a few milliseconds; computing several in a row
      // (exits, precomputed tables) would hold everything else up, so each waits its turn.
      await yieldTurn();
      jumps = table.get(hubId);
      if (!jumps) table.set(hubId, (jumps = jumpsTo(graph, hubId, policy)));
    }
    return { graph, jumps };
  }

  /** Jumps from one system to a hub; null when there is no route (or the system is unknown). */
  async jumps(mapId: string, fromId: number, hubId: number, policy: RoutePolicy): Promise<number | null> {
    const result = await this.jumpsTo(mapId, hubId, policy);
    const i = result?.graph.base.index.get(fromId);
    if (!result || i === undefined) return null;
    const jumps = result.jumps[i]!;
    return jumps < 0 ? null : jumps;
  }

  /**
   * Fills the jump tables of the given policies for the given hubs, so later requests are cheap
   * (after a chain change and on hub changes).
   */
  async precompute(mapId: string, hubIds: readonly number[], modes: readonly RouteMode[]): Promise<void> {
    for (const mode of modes) {
      const policy = policyFor(mode);
      for (const hubId of hubIds) await this.jumpsTo(mapId, hubId, policy);
    }
  }

  /**
   * The nearest system next to a hub that a mode allows, `wanted` deciding what counts, inside the
   * largest stretch of space the mode can travel by stargate (cached).
   */
  stagingFor(
    hubId: number,
    policy: RoutePolicy,
    kind: string,
    wanted: (node: RouteNode) => boolean,
  ): RouteNode | null {
    const key = `${policy.key}:${kind}:${hubId}`;
    if (!this.staging.has(key)) {
      const nameOf = (id: number) => this.deps.universe.getSystem(id)?.name ?? String(id);
      let region = this.regions.get(policy.key);
      if (!region) this.regions.set(policy.key, (region = largestAllowedRegion(this.base, policy)));
      const inRegion = region;
      this.staging.set(
        key,
        nearestStaging(this.base, hubId, policy, (node) => inRegion.has(node.id) && wanted(node), nameOf),
      );
    }
    return this.staging.get(key)!;
  }

  private state(mapId: string): MapRoutes {
    let state = this.maps.get(mapId);
    if (state) {
      // Most recently used last.
      this.maps.delete(mapId);
      this.maps.set(mapId, state);
      return state;
    }
    state = { chain: this.loadChain(mapId), tables: new Map() };
    this.maps.set(mapId, state);
    while (this.maps.size > MAX_MAPS) this.maps.delete(this.maps.keys().next().value!);
    // A failed load must not stay cached.
    state.chain.catch(() => this.maps.get(mapId) === state && this.maps.delete(mapId));
    return state;
  }

  private async loadChain(mapId: string) {
    const chain = await this.deps.chains.chain(mapId);
    if (!chain) return null;
    const visible = new Set(chain.systems.filter((s) => s.visible).map((s) => s.solarSystemId));
    const connections = chain.connections.filter((c) => visible.has(c.source) && visible.has(c.target));
    const edges: ChainEdge[] = connections
      .filter((c) => c.type !== 'gate')
      .map((c) => ({
        a: c.source,
        b: c.target,
        via: c.type === 'bridge' ? 'bridge' : 'wormhole',
        connectionId: c.id,
        connection: { timeStatus: c.timeStatus, massStatus: c.massStatus, shipSize: c.shipSize },
      }));
    const extra = (await Promise.all(this.edgeSources.map((s) => s.edges(mapId)))).flat();
    return { visible, edges, extra, connections };
  }
}

/** Lets other work (requests, sockets) run before a long computation. */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
