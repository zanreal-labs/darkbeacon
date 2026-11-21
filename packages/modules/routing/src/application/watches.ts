import {
  actorRef,
  ForbiddenError,
  mapStream,
  newEvent,
  NotFoundError,
  requireAccount,
  requireMapRole,
  ValidationError,
  type Actor,
  type Clock,
  type NewEvent,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import {
  ROUTE_WATCH_LIMIT,
  type CreateRouteWatchRequest,
  type RouteWatchDto,
  type RouteWatchListDto,
  type RouteWatchRouteDto,
} from '@darkbeacon/shared';
import { findRoute } from '../domain/graph.js';
import { isWormholeSpace, policyFor } from '../domain/modes.js';
import { DEFAULT_ROUTE_OPTIONS, type RouteOptions } from '../domain/options.js';
import { stepWatch, WAITING, watchTrip, type WatchTrip } from '../domain/watches.js';
import type {
  AccountNames,
  RouteWatchRecord,
  RouteWatchRepository,
  RoutingSettingsRepository,
  RoutingUniverse,
} from '../ports/index.js';
import { yieldTurn, type Router } from './router.js';

export interface RouteWatchDeps {
  watches: RouteWatchRepository;
  router: Router;
  universe: RoutingUniverse;
  /** Map routing settings (the Thera toggle); without it Thera is allowed. */
  settings?: RoutingSettingsRepository;
  accounts: AccountNames;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
  newId(): string;
}

const HOUR_MS = 60 * 60_000;
const ROUTING: Actor = { kind: 'system', id: 'routing' };

/**
 * Way-home watches: a member waiting in known space asks to be told when a way from there to the
 * map's Home opens within so many jumps (the whole trip), in high-sec and wormholes only or any
 * way. `evaluate` looks at a map's watches after its chain changed and every minute (expiry, a way
 * gone for five minutes) and publishes `routes.watch_opened` / `routes.watch_closed`, which the
 * Discord notifier posts with a ping for the one who set it. Watches end when they expire.
 */
export class RouteWatches {
  /** One look at a map at a time, so a change and the minute timer never both announce. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: RouteWatchDeps) {}

  /** The caller's watches on the map; map admins see everyone's (they may remove any). */
  async list(actor: Actor | null, mapId: string): Promise<RouteWatchListDto> {
    const role = await requireMapRole(this.deps.access, actor, mapId, 'member');
    const account = requireAccount(actor);
    const now = this.deps.clock.now();
    const watches = (await this.deps.watches.list(mapId)).filter(
      (w) => w.expiresAt > now && (role === 'admin' || w.accountId === account.id),
    );
    return { watches: await this.dtos(watches), home: await this.home(mapId) };
  }

  /**
   * Sets a watch for the caller (members). A second watch from the same system replaces the first
   * (new limits, waiting again); at most `ROUTE_WATCH_LIMIT` per account and map.
   */
  async create(actor: Actor | null, mapId: string, request: CreateRouteWatchRequest): Promise<RouteWatchDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'member');
    const account = requireAccount(actor);
    const system = this.deps.universe.getSystem(request.solarSystemId);
    if (!system) throw new ValidationError(`Unknown solar system ${request.solarSystemId}`);
    if (isWormholeSpace(system))
      throw new ValidationError('Pick a known-space system: a watch waits for a way home from k-space');
    const now = this.deps.clock.now();
    const record: RouteWatchRecord = {
      id: this.deps.newId(),
      mapId,
      accountId: account.id,
      targetSystemId: system.id,
      maxJumps: request.maxJumps,
      mode: request.mode,
      expiresAt: now + request.hours * HOUR_MS,
      createdAt: now,
      state: WAITING,
      route: null,
    };
    return this.deps.uow.transaction(async () => {
      const own = (await this.deps.watches.list(mapId)).filter(
        (w) => w.accountId === account.id && w.expiresAt > now,
      );
      const replaced = own.find((w) => w.targetSystemId === system.id);
      if (!replaced && own.length >= ROUTE_WATCH_LIMIT)
        throw new ValidationError(
          `You already watch ${ROUTE_WATCH_LIMIT} ways home on this map; remove one first`,
        );
      const events: NewEvent[] = [];
      if (replaced) {
        await this.deps.watches.remove(mapId, replaced.id);
        events.push(await this.removedEvent(actor!, replaced, 'removed', now));
      }
      await this.deps.watches.insert(record);
      const [dto] = await this.dtos([record]);
      events.push(
        newEvent({
          stream: mapStream(mapId),
          type: 'routes.watch_added',
          actor: actorRef(actor!),
          data: dto!,
          occurredAt: now,
        }),
      );
      await this.deps.events.append(events);
      return dto!;
    });
  }

  /** Removes a watch: one's own, or anyone's for map admins. */
  async remove(actor: Actor | null, mapId: string, watchId: string): Promise<void> {
    const role = await requireMapRole(this.deps.access, actor, mapId, 'member');
    const account = requireAccount(actor);
    await this.deps.uow.transaction(async () => {
      const watch = await this.deps.watches.find(mapId, watchId);
      if (!watch) throw new NotFoundError('Watch');
      if (watch.accountId !== account.id && role !== 'admin')
        throw new ForbiddenError("Only map admins may remove someone else's watch");
      await this.deps.watches.remove(mapId, watchId);
      await this.deps.events.append([
        await this.removedEvent(actor!, watch, 'removed', this.deps.clock.now()),
      ]);
    });
  }

  /** Looks at every map with watches (expiry, ways gone long enough to call closed). */
  async tick(): Promise<void> {
    for (const mapId of await this.deps.watches.mapsWithWatches()) await this.evaluate(mapId);
  }

  /** Looks at a map's watches now; runs one at a time per map. */
  evaluate(mapId: string): Promise<void> {
    const previous = this.running.get(mapId) ?? Promise.resolve();
    const next = previous.then(() => this.look(mapId));
    const settled = next.catch(() => undefined);
    this.running.set(mapId, settled);
    void settled.then(() => {
      if (this.running.get(mapId) === settled) this.running.delete(mapId);
    });
    return next;
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.deps.watches.forgetMap(mapId);
  }

  private async look(mapId: string): Promise<void> {
    const watches = await this.deps.watches.list(mapId);
    if (watches.length === 0) return;
    const now = this.deps.clock.now();
    const live: RouteWatchRecord[] = [];
    for (const watch of watches) {
      if (watch.expiresAt > now) {
        live.push(watch);
        continue;
      }
      await this.deps.uow.transaction(async () => {
        await this.deps.watches.remove(mapId, watch.id);
        await this.deps.events.append([await this.removedEvent(ROUTING, watch, 'expired', now)]);
      });
    }
    if (live.length === 0) return;

    const chain = await this.deps.router.chain(mapId);
    if (!chain) return;
    const homeId = chain.systems.find((s) => s.status === 'home')?.solarSystemId;
    const homeSystem = homeId === undefined ? null : this.deps.universe.getSystem(homeId);
    // The way home as the Discord digest has it: no end-of-life holes, Thera where the map allows.
    const thera = (await this.deps.settings?.mapSettings(mapId))?.thera ?? true;
    const options: RouteOptions = { ...DEFAULT_ROUTE_OPTIONS, skip: ['eol'], thera };
    const graph = homeSystem ? await this.deps.router.graphFor(mapId, options, null) : null;

    for (const watch of live) {
      let trip: WatchTrip | null = null;
      if (graph && homeSystem) {
        // A search over the universe per watch: let requests through between them.
        await yieldTurn();
        const steps = findRoute(graph, watch.targetSystemId, homeSystem.id, policyFor(watch.mode));
        trip = watchTrip(steps?.flatMap((s) => graph.node(s.id) ?? []) ?? null, watch.maxJumps);
      }
      const step = stepWatch(watch.state, trip && { mouthId: trip.mouthId }, now);
      const route = step.state.open ? (trip ? this.routeDto(trip) : watch.route) : null;
      if (
        step.change === null &&
        JSON.stringify(step.state) === JSON.stringify(watch.state) &&
        JSON.stringify(route) === JSON.stringify(watch.route)
      )
        continue;
      const next: RouteWatchRecord = { ...watch, state: step.state, route };
      await this.deps.uow.transaction(async () => {
        await this.deps.watches.save(next);
        if (step.change === null) return;
        const [dto] = await this.dtos([next]);
        const home = { solarSystemId: homeSystem?.id ?? 0, name: homeSystem?.name ?? '' };
        const event =
          step.change === 'closed'
            ? newEvent({
                stream: mapStream(mapId),
                type: 'routes.watch_closed',
                actor: actorRef(ROUTING),
                data: {
                  watch: dto!,
                  mouth: this.system(step.closedMouthId!),
                  home: homeSystem ? home : null,
                },
                occurredAt: now,
              })
            : newEvent({
                stream: mapStream(mapId),
                type: 'routes.watch_opened',
                actor: actorRef(ROUTING),
                data: { watch: dto!, route: route!, home, change: step.change },
                occurredAt: now,
              });
        await this.deps.events.append([event]);
      });
    }
  }

  private async removedEvent(
    actor: Actor,
    watch: RouteWatchRecord,
    reason: 'removed' | 'expired',
    now: number,
  ): Promise<NewEvent> {
    const [before] = await this.dtos([watch]);
    return newEvent({
      stream: mapStream(watch.mapId),
      type: 'routes.watch_removed',
      actor: actorRef(actor),
      data: { id: watch.id, accountId: watch.accountId, reason },
      before: before!,
      occurredAt: now,
    });
  }

  private async home(mapId: string): Promise<RouteWatchListDto['home']> {
    const chain = await this.deps.router.chain(mapId);
    if (!chain) throw new NotFoundError('Map');
    const id = chain.systems.find((s) => s.status === 'home')?.solarSystemId;
    const system = id === undefined ? null : this.deps.universe.getSystem(id);
    return system ? { solarSystemId: system.id, name: system.name } : null;
  }

  private async dtos(watches: readonly RouteWatchRecord[]): Promise<RouteWatchDto[]> {
    const names = await this.deps.accounts.names([...new Set(watches.map((w) => w.accountId))]);
    return watches
      .map((w) => ({
        id: w.id,
        mapId: w.mapId,
        accountId: w.accountId,
        ownerName: names.get(w.accountId) ?? 'Someone',
        target: this.system(w.targetSystemId),
        maxJumps: w.maxJumps,
        mode: w.mode,
        expiresAt: w.expiresAt,
        createdAt: w.createdAt,
        route: w.route,
      }))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  private routeDto(trip: WatchTrip): RouteWatchRouteDto {
    return {
      jumps: trip.jumps,
      gates: trip.gates,
      wormholeJumps: trip.wormholeJumps,
      mouth: this.system(trip.mouthId),
    };
  }

  private system(solarSystemId: number): RouteWatchRouteDto['mouth'] {
    const system = this.deps.universe.getSystem(solarSystemId);
    return { solarSystemId, name: system?.name ?? String(solarSystemId), security: system?.security ?? 0 };
  }
}
