import type { ConnectionDto, MapSystemDto, RouteMode, RouteSkip } from '@darkbeacon/shared';
import { isForeignBridge } from '../domain/bridges.js';
import { RouteGraph, StargateGraph, jumpsTo } from '../domain/graph.js';
import { largestAllowedRegion, nearestStaging } from '../domain/hubs.js';
import { policyFor, type RouteNode, type RoutePolicy } from '../domain/modes.js';
import {
  DEFAULT_ROUTE_OPTIONS,
  edgeKey,
  usableEdge,
  type RouteOptions,
  type RoutedEdge,
} from '../domain/options.js';
import type {
  ChainSource,
  InvasionLookup,
  RouteEdgeSource,
  RoutingUniverse,
  SovereigntyLookup,
} from '../ports/index.js';

/** A chain connection the router may use, with what route options filter on. */
export type ChainEdge = RoutedEdge;

export interface ChainState {
  /** Visible systems of the chain. */
  visible: Set<number>;
  /** Visible systems with their status (the way home starts at `home`). */
  systems: Array<{ solarSystemId: number; status: MapSystemDto['status'] | undefined }>;
  /** Usable connections between visible systems (gates on the map add nothing). */
  edges: ChainEdge[];
  /** Edges of the edge sources: jump bridges, EVE-Scout holes. */
  extra: RoutedEdge[];
  connections: ConnectionDto[];
}

interface MapRoutes {
  chain: Promise<ChainState | null>;
  /** Graphs by edge key (see `edgeKey`). */
  graphs: Map<string, Promise<RouteGraph | null>>;
  /** `<edge key>#<policy key>` -> hub system id -> jumps from every system (by graph index). */
  tables: Map<string, Map<number, Int16Array>>;
  /** Results derived from this state (exits), dropped with it. */
  memo?: Map<string, Promise<unknown>>;
}

/** Maps whose routing data is kept; the least recently used one goes first. */
const MAX_MAPS = 64;
/** Jump table sets (edge options and policy) kept per map; the oldest goes first. */
const MAX_TABLES = 48;

export interface RouterDeps {
  universe: RoutingUniverse;
  chains: ChainSource;
  invasion?: InvasionLookup;
  sovereignty?: SovereigntyLookup;
}

/**
 * The route engine's state: the stargate graph (built once), and per map the chain overlay,
 * graphs per set of route options and cached jump tables towards hubs, one per route policy.
 * `invalidate` drops a map's state after any change to its systems or connections; tables are
 * then rebuilt on demand.
 */
export class Router {
  private stargates: StargateGraph | undefined;
  private readonly maps = new Map<string, MapRoutes>();
  private readonly staging = new Map<string, RouteNode | null>();
  private readonly regions = new Map<string, Set<number>>();
  private readonly edgeSources: RouteEdgeSource[] = [];

  constructor(private readonly deps: RouterDeps) {}

  /** Adds a source of extra edges (jump bridges, EVE-Scout); every map's state is rebuilt. */
  addEdgeSource(source: RouteEdgeSource): void {
    this.edgeSources.push(source);
    this.maps.clear();
  }

  /** The stargate graph of the whole universe. */
  get base(): StargateGraph {
    this.stargates ??= new StargateGraph(
      [...this.deps.universe.systems()].map((s) => {
        const invasion = this.deps.invasion?.of(s.id);
        return { id: s.id, security: s.security, whClass: s.whClass, ...(invasion ? { invasion } : {}) };
      }),
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

  /** Drops every map's state (an edge source changed for all of them). */
  invalidateAll(): void {
    this.maps.clear();
  }

  /** Maps with routing state right now (the ones people look at). */
  activeMaps(): string[] {
    return [...this.maps.keys()];
  }

  /** The chain of a map as the router sees it; null when the map does not exist. */
  chain(mapId: string): Promise<ChainState | null> {
    return this.state(mapId).chain;
  }

  /** Stargates plus the whole chain and every extra edge (no options applied). */
  graph(mapId: string): Promise<RouteGraph | null> {
    return this.graphFor(mapId, DEFAULT_ROUTE_OPTIONS, null);
  }

  /** Stargates plus the chain without the connections `skip` rules out. */
  graphWith(mapId: string, skip: readonly RouteSkip[]): Promise<RouteGraph | null> {
    return this.graphFor(mapId, { ...DEFAULT_ROUTE_OPTIONS, skip }, null);
  }

  /**
   * Stargates plus what the options let a route use of the chain and the extra edges; `alliance`
   * is the pilot's, for which jump bridges they may use.
   */
  graphFor(mapId: string, options: RouteOptions, alliance: number | null): Promise<RouteGraph | null> {
    const state = this.state(mapId);
    const key = edgeKey(options, alliance);
    let graph = state.graphs.get(key);
    if (!graph) {
      const foreign = (edge: RoutedEdge) =>
        this.deps.sovereignty !== undefined &&
        isForeignBridge(edge.a, edge.b, alliance, (id) => this.deps.sovereignty!.holderOf(id));
      graph = state.chain.then((chain) =>
        chain
          ? new RouteGraph(
              this.base,
              [...chain.edges, ...chain.extra].filter((edge) => usableEdge(edge, options, foreign)),
            )
          : null,
      );
      state.graphs.set(key, graph);
    }
    return graph;
  }

  /** Jumps from every system to a hub under a policy, cached until the map changes. */
  async jumpsTo(
    mapId: string,
    hubId: number,
    policy: RoutePolicy,
    options: RouteOptions = DEFAULT_ROUTE_OPTIONS,
    alliance: number | null = null,
  ): Promise<{ graph: RouteGraph; jumps: Int16Array } | null> {
    const state = this.state(mapId);
    const graph = await this.graphFor(mapId, options, alliance);
    if (!graph) return null;
    const key = `${edgeKey(options, alliance)}#${policy.key}`;
    let table = state.tables.get(key);
    if (!table) {
      state.tables.set(key, (table = new Map()));
      while (state.tables.size > MAX_TABLES) state.tables.delete(state.tables.keys().next().value!);
    }
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
  async jumps(
    mapId: string,
    fromId: number,
    hubId: number,
    policy: RoutePolicy,
    options: RouteOptions = DEFAULT_ROUTE_OPTIONS,
    alliance: number | null = null,
  ): Promise<number | null> {
    const result = await this.jumpsTo(mapId, hubId, policy, options, alliance);
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
    state = { chain: this.loadChain(mapId), graphs: new Map(), tables: new Map() };
    this.maps.set(mapId, state);
    while (this.maps.size > MAX_MAPS) this.maps.delete(this.maps.keys().next().value!);
    // A failed load must not stay cached.
    state.chain.catch(() => this.maps.get(mapId) === state && this.maps.delete(mapId));
    return state;
  }

  private async loadChain(mapId: string): Promise<ChainState | null> {
    const chain = await this.deps.chains.chain(mapId);
    if (!chain) return null;
    const shown = chain.systems.filter((s) => s.visible);
    const visible = new Set(shown.map((s) => s.solarSystemId));
    const connections = chain.connections.filter((c) => visible.has(c.source) && visible.has(c.target));
    const edges: ChainEdge[] = connections
      .filter((c) => c.type !== 'gate')
      .map((c) => ({
        a: c.source,
        b: c.target,
        via: c.type === 'bridge' ? 'bridge' : 'wormhole',
        connectionId: c.id,
        state: {
          timeStatus: c.timeStatus,
          massStatus: c.massStatus,
          shipSize: c.shipSize,
          dangerous: c.dangerous,
          bubbled: c.bubbled,
        },
      }));
    const extra = (await Promise.all(this.edgeSources.map((s) => s.edges(mapId)))).flat();
    return {
      visible,
      systems: shown.map((s) => ({ solarSystemId: s.solarSystemId, status: s.status })),
      edges,
      extra,
      connections,
    };
  }
}

/** Lets other work (requests, sockets) run before a long computation. */
export function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
