import {
  ForbiddenError,
  NotFoundError,
  requireAccount,
  requireMapRole,
  ValidationError,
  type Actor,
  type MapAccess,
} from '@darkbeacon/core';
import {
  classLabel,
  wormholeDestination,
  type ExitsQuery,
  type HubDistanceDto,
  type HubDistancesQuery,
  type HubDto,
  type HubRouteDto,
  type HubRoutesDto,
  type HubRoutesQuery,
  type HubsUnreachable,
  type HubsDto,
  type MapExitDto,
  type MapExitsDto,
  type RouteDto,
  type RouteMode,
  type RouteQuery,
  type RoutesByDto,
  type RoutesByEntryDto,
  type RoutesByQuery,
  type RouteStepDto,
  type StationDto,
  type WayHomeDto,
  type WayHomeRouteDto,
  type WormholeDestination,
} from '@darkbeacon/shared';
import { findRoute, routesFrom, type RouteGraph, type RouteStep, type RouteTree } from '../domain/graph.js';
import { isLowSec, MAX_HUBS, TRADE_HUBS } from '../domain/hubs.js';
import { isWormholeSpace, policyFor, routeSpace, type RouteNode, type RoutePolicy } from '../domain/modes.js';
import { DEFAULT_ROUTE_OPTIONS, routeOptions, withAvoidance, type RouteOptions } from '../domain/options.js';
import { closedLevels, HIGH_SEC_MIN } from '../domain/security.js';
import type {
  AllianceDirectory,
  HubRepository,
  PilotDirectory,
  PingTargets,
  RoutingSettingsRepository,
  RoutingUniverse,
  StationCatalog,
} from '../ports/index.js';
import type { TheraFeed } from './eve-scout.js';
import { yieldTurn, type Router } from './router.js';

export interface RouteQueryDeps {
  router: Router;
  universe: RoutingUniverse;
  hubs: HubRepository;
  pilots: PilotDirectory;
  access: MapAccess;
  /** Map routing settings (the Thera toggle); without it Thera is allowed everywhere. */
  settings?: RoutingSettingsRepository;
  /** The viewer's alliance, for the jump bridges they may use. */
  alliances?: AllianceDirectory;
  stations?: StationCatalog;
  pings?: PingTargets;
  thera?: TheraFeed;
}

type OptionQuery = Parameters<typeof routeOptions>[0] & {
  mode: RouteMode;
  characterId?: number | undefined;
  securityStatus?: number | undefined;
};

/** Thera and Turnur, the hubs of EVE-Scout's lists. */
const THERA = 31000005;
const TURNUR = 30002086;

/**
 * Options of the exits every viewer sees (`routes.exits_changed`, node badges): the chain, the
 * map's bridges and the stargates. EVE-Scout's holes come and go by the minute, so they stay out.
 */
const SHARED_OPTIONS: RouteOptions = { ...DEFAULT_ROUTE_OPTIONS, thera: false };

/** Static types that lead to known space count as exits. */
const KNOWN_SPACE: ReadonlySet<WormholeDestination> = new Set(['hs', 'ls', 'ns']);

/** Routes, hub distances and exits of a map's chain, for anyone who may view the map. */
export class RouteQueries {
  constructor(private readonly deps: RouteQueryDeps) {}

  async route(actor: Actor | null, mapId: string, query: RouteQuery): Promise<RouteDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    this.system(query.from);
    this.system(query.to);
    const { policy, securityStatus, options, alliance } = await this.request(actor, mapId, query);
    const graph = await this.deps.router.graphFor(mapId, options, alliance);
    if (!graph) throw new NotFoundError('Map');
    const steps = findRoute(graph, query.from, query.to, policy);
    return {
      from: query.from,
      to: query.to,
      mode: query.mode,
      jumps: steps ? steps.length - 1 : null,
      steps: (steps ?? []).map((step) => this.step(step)),
      securityStatus,
    };
  }

  /**
   * Routes from one system to every hub of a list in one go: the map's hubs (pinged systems
   * first) or the viewer's own, nearest first, with the systems on the way.
   */
  async hubRoutes(actor: Actor | null, mapId: string, query: HubRoutesQuery): Promise<HubRoutesDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    this.system(query.from);
    const hubs =
      query.hubs === 'personal'
        ? actor?.kind === 'account'
          ? await this.personalHubs(actor.id)
          : []
        : await this.mapAndPingHubs(mapId);
    const { policy, options, alliance } = await this.request(actor, mapId, query);
    const graph = await this.deps.router.graphFor(mapId, options, alliance);
    if (!graph) throw new NotFoundError('Map');
    const tree = routesFrom(graph, query.from, policy);
    const routes: HubRouteDto[] = hubs.map((hub) => {
      const steps = tree.to(hub.solarSystemId);
      return {
        ...hub,
        jumps: steps ? steps.length - 1 : null,
        steps: (steps ?? []).map((s) => this.step(s)),
      };
    });
    // A rally ping heads the list (the fleet goes there now), then the hubs nearest first.
    const pinged = (r: HubRouteDto) => (r.kind === 'ping' ? 0 : 1);
    routes.sort(
      (a, b) =>
        pinged(a) - pinged(b) ||
        (a.jumps ?? Infinity) - (b.jumps ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
    const none = routes.length > 0 && routes.every((r) => r.jumps === null);
    return {
      from: query.from,
      mode: query.mode,
      routes,
      limit: MAX_HUBS,
      ...(none ? { unreachable: await this.unreachable(mapId, query.from, graph, tree) } : {}),
    };
  }

  /**
   * Why no hub can be reached from a system: it has no connection on the map at all (a lone
   * wormhole system), no route leaves its chain for known space, or the route options keep
   * every hub out of reach.
   */
  private async unreachable(
    mapId: string,
    fromId: number,
    graph: RouteGraph,
    tree: RouteTree,
  ): Promise<HubsUnreachable> {
    const at = graph.base.index.get(fromId);
    const chain = await this.deps.router.chain(mapId);
    const linked = chain?.connections.some((c) => c.source === fromId || c.target === fromId) ?? false;
    if (!linked && at !== undefined && graph.links(at).next().done) return 'isolated';
    const known = (node: RouteNode) => !isWormholeSpace(node) && node.whClass !== 25;
    return tree.reaches(known) ? 'options' : 'no-exit';
  }

  /** The nearest places of a kind from one system, with their stations and the way there. */
  async routesBy(actor: Actor | null, mapId: string, query: RoutesByQuery): Promise<RoutesByDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    this.system(query.from);
    const { policy, options, alliance } = await this.request(actor, mapId, query);
    const graph = await this.deps.router.graphFor(mapId, options, alliance);
    if (!graph) throw new NotFoundError('Map');
    const tree = routesFrom(graph, query.from, policy);
    const entries: RoutesByEntryDto[] = [];
    for (const [solarSystemId, stations] of this.placesOf(query.kind)) {
      const system = this.deps.universe.getSystem(solarSystemId);
      if (!system || (query.highsec && system.security < HIGH_SEC_MIN)) continue;
      const steps = tree.to(solarSystemId);
      if (!steps) continue;
      entries.push({
        solarSystemId,
        name: system.name,
        security: system.security,
        jumps: steps.length - 1,
        steps: steps.map((s) => this.step(s)),
        stations,
      });
    }
    entries.sort((a, b) => a.jumps - b.jumps || a.name.localeCompare(b.name));
    return { from: query.from, kind: query.kind, entries: entries.slice(0, query.limit) };
  }

  /** The map's way home, for anyone who may view the map. */
  async viewWayHome(actor: Actor | null, mapId: string): Promise<WayHomeDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return this.wayHome(mapId);
  }

  /**
   * The way home from each of the map's hubs (the trade hubs when it has none) to its home
   * system: the shortest way without end-of-life holes, through EVE-Scout's Thera and Turnur
   * holes when the map allows them, naming the mouth where the trip leaves known space.
   */
  async wayHome(mapId: string): Promise<WayHomeDto> {
    const chain = await this.deps.router.chain(mapId);
    if (!chain) throw new NotFoundError('Map');
    const home = chain.systems.find((s) => s.status === 'home');
    const homeSystem = home && this.deps.universe.getSystem(home.solarSystemId);
    if (!home || !homeSystem) return { home: null, routes: [] };
    const thera = (await this.deps.settings?.mapSettings(mapId))?.thera ?? true;
    const options: RouteOptions = { ...DEFAULT_ROUTE_OPTIONS, skip: ['eol'], thera };
    const graph = await this.deps.router.graphFor(mapId, options, null);
    if (!graph) throw new NotFoundError('Map');
    const mapHubs = await this.mapHubs(mapId);
    const hubs = (
      mapHubs.length > 0 ? mapHubs : TRADE_HUBS.flatMap((h) => this.hub(h.solarSystemId, 'trade') ?? [])
    ).filter((h) => h.solarSystemId !== home.solarSystemId);
    const tree = routesFrom(graph, home.solarSystemId, policyFor('shortest'));
    const routes: WayHomeRouteDto[] = [];
    for (const hub of hubs) {
      const steps = tree.to(hub.solarSystemId);
      if (!steps) continue;
      const nodes = steps.flatMap((s) => graph.node(s.id) ?? []);
      const at = nodes.findIndex((n) => !isWormholeSpace(n) && n.whClass !== 25);
      const mouth = at >= 0 ? this.deps.universe.getSystem(nodes[at]!.id) : null;
      if (!mouth) continue;
      const known = nodes.slice(at).filter((n) => !isWormholeSpace(n));
      const high = known.filter((n) => n.security >= HIGH_SEC_MIN).length;
      routes.push({
        hub,
        jumps: steps.length - 1,
        mouth: { solarSystemId: mouth.id, name: mouth.name, security: mouth.security },
        space: high === known.length ? 'high' : high === 0 ? 'low' : 'mixed',
        viaEveScout: steps.some((s) => s.origin === 'eve-scout'),
      });
    }
    routes.sort((a, b) => a.jumps - b.jumps || a.hub.name.localeCompare(b.hub.name));
    return { home: { solarSystemId: homeSystem.id, name: homeSystem.name }, routes };
  }

  /** The hubs the actor gets distances to on this map (without a mode's staging systems). */
  async hubs(actor: Actor | null, mapId: string): Promise<HubsDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return {
      trade: TRADE_HUBS.flatMap((hub) => this.hub(hub.solarSystemId, 'trade') ?? []),
      map: await this.mapHubs(mapId),
      personal: actor?.kind === 'account' ? await this.personalHubs(actor.id) : [],
    };
  }

  async hubDistances(
    actor: Actor | null,
    mapId: string,
    query: HubDistancesQuery,
  ): Promise<HubDistanceDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    this.system(query.from);
    const { policy, options, alliance } = await this.request(actor, mapId, query);
    const hubs = await this.hubsFor(mapId, policy, actor);
    return this.distances(mapId, query.from, hubs, policy, options, alliance);
  }

  async exits(actor: Actor | null, mapId: string, query: ExitsQuery): Promise<MapExitsDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const { policy, options, alliance } = await this.request(actor, mapId, query);
    return {
      mode: query.mode,
      exits: await this.exitsOf(mapId, policy, await this.hubsFor(mapId, policy, actor), options, alliance),
    };
  }

  /**
   * Exits for everyone on the map (shortest mode, trade and map hubs): what `routes.exits_changed`
   * and map snapshots carry. No authorization; callers decide who sees it.
   */
  sharedExits(mapId: string): Promise<MapExitDto[]> {
    // Every map snapshot carries them, and each exit's route space is a search over the universe:
    // computed once per state of the chain and its hubs, not once per snapshot.
    return this.deps.router.derived(mapId, 'sharedExits', async () => {
      const policy = policyFor('shortest');
      return this.exitsOf(mapId, policy, await this.hubsFor(mapId, policy, null), SHARED_OPTIONS, null);
    });
  }

  async mapHubs(mapId: string): Promise<HubDto[]> {
    return (await this.deps.hubs.mapHubs(mapId)).flatMap((id) => this.hub(id, 'map') ?? []);
  }

  async personalHubs(accountId: string): Promise<HubDto[]> {
    return (await this.deps.hubs.personalHubs(accountId)).flatMap((id) => this.hub(id, 'personal') ?? []);
  }

  /** Trade hubs (or their staging systems where the mode forbids them), map and own hubs. */
  private async hubsFor(mapId: string, policy: RoutePolicy, actor: Actor | null): Promise<HubDto[]> {
    const result: HubDto[] = [];
    for (const trade of TRADE_HUBS) {
      const node = this.deps.router.base.nodes[this.deps.router.base.index.get(trade.solarSystemId) ?? -1];
      if (!node) continue;
      if (policy.allows(node)) {
        result.push(this.hub(trade.solarSystemId, 'trade')!);
        continue;
      }
      const wanted =
        policy.mode === 'outlaw' ? isLowSec : (n: RouteNode) => !isWormholeSpace(n) && n.whClass !== 25;
      const staging = this.deps.router.stagingFor(trade.solarSystemId, policy, policy.mode, wanted);
      const hub = staging && this.hub(staging.id, 'staging');
      if (hub) result.push({ ...hub, near: { solarSystemId: trade.solarSystemId, name: trade.name } });
    }
    result.push(...(await this.mapHubs(mapId)));
    if (actor?.kind === 'account') result.push(...(await this.personalHubs(actor.id)));
    // One entry per system: the first kind wins (trade, staging, map, personal).
    const seen = new Set<number>();
    return result.filter((hub) => !seen.has(hub.solarSystemId) && seen.add(hub.solarSystemId));
  }

  private async distances(
    mapId: string,
    fromId: number,
    hubs: HubDto[],
    policy: RoutePolicy,
    options: RouteOptions,
    alliance: number | null,
  ) {
    const result: HubDistanceDto[] = [];
    for (const hub of hubs) {
      result.push({
        ...hub,
        jumps: await this.deps.router.jumps(mapId, fromId, hub.solarSystemId, policy, options, alliance),
      });
    }
    return result.sort(
      (a, b) => (a.jumps ?? Infinity) - (b.jumps ?? Infinity) || a.name.localeCompare(b.name),
    );
  }

  /**
   * The chain's exits. A connected exit's hubs come from the very search the Routes widget runs
   * from that system (`hubRoutes`: one `routesFrom` over the same graph, policy and tie-break),
   * so the jumps on an exit's chip are the jumps the widget shows for that hub from that exit.
   */
  private async exitsOf(
    mapId: string,
    policy: RoutePolicy,
    hubs: HubDto[],
    options: RouteOptions,
    alliance: number | null,
  ): Promise<MapExitDto[]> {
    const chain = await this.deps.router.chain(mapId);
    const graph = await this.deps.router.graphFor(mapId, options, alliance);
    if (!chain || !graph) throw new NotFoundError('Map');
    const { universe } = this.deps;
    const connected: MapExitDto[] = [];
    const statics: MapExitDto[] = [];
    // Known-space destinations already reached through a wormhole, per wormhole system.
    const reached = new Map<number, WormholeDestination[]>();

    for (const id of chain.visible) {
      const system = universe.getSystem(id);
      if (!system || isWormholeSpace(system)) continue;
      const via = chain.connections.find(
        (c) => c.type === 'wormhole' && (c.source === id || c.target === id),
      );
      if (!via) continue;
      const other = via.source === id ? via.target : via.source;
      for (const c of chain.connections) {
        if (c.type !== 'wormhole' || (c.source !== id && c.target !== id)) continue;
        const from = c.source === id ? c.target : c.source;
        const destination = classDestination(system.whClass);
        if (destination) reached.set(from, [...(reached.get(from) ?? []), destination]);
      }
      // A search over the whole universe: one exit at a time, letting requests through between.
      await yieldTurn();
      const tree = routesFrom(graph, id, policy);
      const routes = new Map(hubs.map((hub) => [hub.solarSystemId, tree.to(hub.solarSystemId)]));
      const distances: HubDistanceDto[] = hubs
        .map((hub) => {
          const steps = routes.get(hub.solarSystemId);
          return { ...hub, jumps: steps ? steps.length - 1 : null };
        })
        .sort((a, b) => (a.jumps ?? Infinity) - (b.jumps ?? Infinity) || a.name.localeCompare(b.name));
      const nearest = distances.find((d) => d.jumps !== null) ?? null;
      const nearestSteps = nearest ? routes.get(nearest.solarSystemId) : null;
      connected.push({
        kind: 'connected',
        solarSystemId: id,
        name: system.name,
        security: system.security,
        whClass: system.whClass,
        classLabel: classLabel(system.whClass),
        connectionId: via.id,
        chainSystemId: other,
        statics: [],
        nearest: nearest && {
          ...nearest,
          space: nearestSteps
            ? routeSpace(nearestSteps.flatMap((step) => graph.node(step.id) ?? []))
            : 'mixed',
        },
        hubs: distances,
      });
    }

    for (const id of chain.visible) {
      const system = universe.getSystem(id);
      if (!system || !isWormholeSpace(system)) continue;
      const used = [...(reached.get(id) ?? [])];
      const open: MapExitDto['statics'] = [];
      for (const code of system.statics) {
        const destination = wormholeDestination(code);
        if (!destination || !KNOWN_SPACE.has(destination)) continue;
        const at = used.indexOf(destination);
        if (at >= 0) used.splice(at, 1);
        else open.push({ code, destination });
      }
      if (open.length === 0) continue;
      statics.push({
        kind: 'static',
        solarSystemId: id,
        name: system.name,
        security: system.security,
        whClass: system.whClass,
        classLabel: classLabel(system.whClass),
        connectionId: null,
        chainSystemId: null,
        statics: open,
        nearest: null,
        hubs: [],
      });
    }

    connected.sort(
      (a, b) =>
        (a.nearest?.jumps ?? Infinity) - (b.nearest?.jumps ?? Infinity) || a.name.localeCompare(b.name),
    );
    statics.sort((a, b) => a.name.localeCompare(b.name));
    return [...connected, ...statics];
  }

  /**
   * Everything a routing request needs: its policy (keeping out of the avoided systems and
   * space), its options (Thera only where the map allows it) and the pilot's alliance, which
   * decides the jump bridges they may use: in `pilot` mode the chosen character's (an alt in the
   * alliance holding the bridges may take them while the main may not), else the main's.
   */
  private async request(actor: Actor | null, mapId: string, query: OptionQuery) {
    const { policy, securityStatus } = await this.policy(actor, query);
    const options = routeOptions(query);
    if (options.thera && (await this.deps.settings?.mapSettings(mapId))?.thera === false) {
      options.thera = false;
    }
    const pilot = query.mode === 'pilot' ? query.characterId : undefined;
    const alliance =
      options.bridges && !options.capital && actor?.kind === 'account' && this.deps.alliances
        ? await this.deps.alliances.allianceOf(actor.id, pilot)
        : null;
    return { policy: withAvoidance(policy, options), securityStatus, options, alliance };
  }

  /** The policy of a request; `pilot` needs a security status, given or read for an own character. */
  private async policy(
    actor: Actor | null,
    query: { mode: RouteMode; characterId?: number | undefined; securityStatus?: number | undefined },
  ): Promise<{ policy: RoutePolicy; securityStatus: number | null }> {
    if (query.mode !== 'pilot') return { policy: policyFor(query.mode), securityStatus: null };
    let status = query.securityStatus ?? null;
    if (status === null && query.characterId !== undefined) {
      const account = requireAccount(actor);
      if ((await this.deps.pilots.ownerOf(query.characterId)) !== account.id)
        throw new ForbiddenError('That character is not linked to your account');
      status = await this.deps.pilots.securityStatus(query.characterId);
      if (status === null) throw new ValidationError("ESI does not know this character's security status");
    }
    if (status === null)
      throw new ValidationError('Pick a character or give a security status for this route');
    return { policy: policyFor('pilot', closedLevels(status)), securityStatus: status };
  }

  /** Pinged systems first (temporary targets), then the map's own hubs. */
  private async mapAndPingHubs(mapId: string): Promise<HubDto[]> {
    const pinged = (await this.deps.pings?.pinged(mapId)) ?? [];
    const result = [...pinged.flatMap((id) => this.hub(id, 'ping') ?? []), ...(await this.mapHubs(mapId))];
    const seen = new Set<number>();
    return result.filter((hub) => !seen.has(hub.solarSystemId) && seen.add(hub.solarSystemId));
  }

  /** Systems of a Routes By kind, with the stations there that count. */
  private placesOf(kind: RoutesByQuery['kind']): Map<number, StationDto[]> {
    const places = new Map<number, StationDto[]>();
    if (kind === 'thera' || kind === 'turnur') {
      const hubId = kind === 'thera' ? THERA : TURNUR;
      for (const c of this.deps.thera?.connections() ?? []) {
        if (c.hubSystemId === hubId) places.set(c.solarSystemId, []);
      }
      return places;
    }
    if (kind === 'tradeHubs') {
      for (const hub of TRADE_HUBS) {
        const stations = this.deps.stations?.stationsIn(hub.solarSystemId) ?? [];
        places.set(
          hub.solarSystemId,
          [...stations].sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name)),
        );
      }
      return places;
    }
    for (const station of this.deps.stations?.places(kind) ?? []) {
      places.set(station.solarSystemId, [...(places.get(station.solarSystemId) ?? []), station]);
    }
    return places;
  }

  /** One system of a route as the API shows it. */
  private step(step: RouteStep): RouteStepDto {
    const system = this.deps.universe.getSystem(step.id);
    const { base } = this.deps.router;
    const node = base.nodes[base.index.get(step.id) ?? -1];
    return {
      solarSystemId: step.id,
      name: system?.name ?? String(step.id),
      security: system?.security ?? 0,
      whClass: system?.whClass ?? null,
      classLabel: classLabel(system?.whClass),
      via: step.via,
      connectionId: step.connectionId,
      ...(step.origin ? { edge: step.origin } : {}),
      ...(system ? { regionName: system.regionName } : {}),
      ...(node?.invasion ? { invasion: node.invasion } : {}),
    };
  }

  private hub(solarSystemId: number, kind: HubDto['kind']): HubDto | null {
    const system = this.deps.universe.getSystem(solarSystemId);
    if (!system) return null;
    return { solarSystemId, name: system.name, security: system.security, kind, near: null };
  }

  private system(solarSystemId: number) {
    const system = this.deps.universe.getSystem(solarSystemId);
    if (!system) throw new ValidationError(`Unknown solar system ${solarSystemId}`);
    return system;
  }
}

/** The static destination a known-space system of this class answers. */
function classDestination(whClass: number | null): WormholeDestination | null {
  if (whClass === 7) return 'hs';
  if (whClass === 8) return 'ls';
  if (whClass === 9) return 'ns';
  return null;
}
