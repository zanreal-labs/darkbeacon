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
  type HubsDto,
  type MapExitDto,
  type MapExitsDto,
  type RouteDto,
  type RouteMode,
  type RouteQuery,
  type WormholeDestination,
} from '@darkbeacon/shared';
import { findRoute } from '../domain/graph.js';
import { isLowSec, TRADE_HUBS } from '../domain/hubs.js';
import { isWormholeSpace, policyFor, routeSpace, type RouteNode, type RoutePolicy } from '../domain/modes.js';
import { closedLevels } from '../domain/security.js';
import type { HubRepository, PilotDirectory, RoutingUniverse } from '../ports/index.js';
import type { Router } from './router.js';

export interface RouteQueryDeps {
  router: Router;
  universe: RoutingUniverse;
  hubs: HubRepository;
  pilots: PilotDirectory;
  access: MapAccess;
}

/** Static types that lead to known space count as exits. */
const KNOWN_SPACE: ReadonlySet<WormholeDestination> = new Set(['hs', 'ls', 'ns']);

/** Routes, hub distances and exits of a map's chain, for anyone who may view the map. */
export class RouteQueries {
  constructor(private readonly deps: RouteQueryDeps) {}

  async route(actor: Actor | null, mapId: string, query: RouteQuery): Promise<RouteDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    this.system(query.from);
    this.system(query.to);
    const { policy, securityStatus } = await this.policy(actor, query);
    const graph = await this.deps.router.graphWith(mapId, query.skip ?? []);
    if (!graph) throw new NotFoundError('Map');
    const steps = findRoute(graph, query.from, query.to, policy, new Set(query.avoid ?? []));
    return {
      from: query.from,
      to: query.to,
      mode: query.mode,
      jumps: steps ? steps.length - 1 : null,
      steps: (steps ?? []).map((step) => {
        const system = this.deps.universe.getSystem(step.id);
        return {
          solarSystemId: step.id,
          name: system?.name ?? String(step.id),
          security: system?.security ?? 0,
          whClass: system?.whClass ?? null,
          classLabel: classLabel(system?.whClass),
          via: step.via,
          connectionId: step.connectionId,
        };
      }),
      securityStatus,
    };
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
    const { policy } = await this.policy(actor, query);
    const hubs = await this.hubsFor(mapId, policy, actor);
    return this.distances(mapId, query.from, hubs, policy);
  }

  async exits(actor: Actor | null, mapId: string, query: ExitsQuery): Promise<MapExitsDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    const { policy } = await this.policy(actor, query);
    return {
      mode: query.mode,
      exits: await this.exitsOf(mapId, policy, await this.hubsFor(mapId, policy, actor)),
    };
  }

  /**
   * Exits for everyone on the map (shortest mode, trade and map hubs): what `routes.exits_changed`
   * and map snapshots carry. No authorization; callers decide who sees it.
   */
  async sharedExits(mapId: string): Promise<MapExitDto[]> {
    const policy = policyFor('shortest');
    return this.exitsOf(mapId, policy, await this.hubsFor(mapId, policy, null));
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

  private async distances(mapId: string, fromId: number, hubs: HubDto[], policy: RoutePolicy) {
    const result: HubDistanceDto[] = [];
    for (const hub of hubs) {
      result.push({ ...hub, jumps: await this.deps.router.jumps(mapId, fromId, hub.solarSystemId, policy) });
    }
    return result.sort(
      (a, b) => (a.jumps ?? Infinity) - (b.jumps ?? Infinity) || a.name.localeCompare(b.name),
    );
  }

  /** The kind of space the route from an exit to its nearest hub runs through. */
  private async spaceOf(mapId: string, fromId: number, hubId: number, policy: RoutePolicy) {
    const graph = await this.deps.router.graph(mapId);
    const steps = graph && findRoute(graph, fromId, hubId, policy);
    if (!graph || !steps) return 'mixed' as const;
    return routeSpace(steps.flatMap((step) => graph.node(step.id) ?? []));
  }

  private async exitsOf(mapId: string, policy: RoutePolicy, hubs: HubDto[]): Promise<MapExitDto[]> {
    const chain = await this.deps.router.chain(mapId);
    if (!chain) throw new NotFoundError('Map');
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
      const distances = await this.distances(mapId, id, hubs, policy);
      const nearest = distances.find((d) => d.jumps !== null) ?? null;
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
          space: await this.spaceOf(mapId, id, nearest.solarSystemId, policy),
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
