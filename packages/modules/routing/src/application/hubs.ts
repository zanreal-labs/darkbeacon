import {
  actorRef,
  mapStream,
  newEvent,
  NotFoundError,
  requireAccount,
  requireMapRole,
  ValidationError,
  type Actor,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { HubDto, MapExitDto } from '@darkbeacon/shared';
import { MAX_HUBS, withDefaultHubs } from '../domain/hubs.js';
import type { HubRepository, RoutingUniverse } from '../ports/index.js';
import type { RouteQueries } from './routes.js';

export interface HubAdminDeps {
  hubs: HubRepository;
  queries: RouteQueries;
  universe: RoutingUniverse;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
}

/** The map's own hubs (managers) and each account's personal hubs. */
export class HubAdmin {
  constructor(private readonly deps: HubAdminDeps) {}

  /**
   * Replaces the map's hubs and publishes `routes.hubs_changed`. Members may, as they add and
   * remove systems: hubs are part of keeping the map.
   */
  async setMapHubs(actor: Actor | null, mapId: string, solarSystemIds: readonly number[]): Promise<HubDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'member');
    const ids = this.validate(solarSystemIds);
    return this.deps.uow.transaction(async () => {
      const before = await this.deps.queries.mapHubs(mapId);
      await this.deps.hubs.setMapHubs(mapId, ids);
      const hubs = await this.deps.queries.mapHubs(mapId);
      await this.deps.events.append([
        newEvent({
          stream: mapStream(mapId),
          type: 'routes.hubs_changed',
          actor: actorRef(actor!),
          data: { hubs },
          before: { hubs: before },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
      return hubs;
    });
  }

  async personalHubs(actor: Actor | null): Promise<HubDto[]> {
    return this.deps.queries.personalHubs(requireAccount(actor).id);
  }

  /** Replaces the caller's own hubs. Private to the account, so no event. */
  async setPersonalHubs(actor: Actor | null, solarSystemIds: readonly number[]): Promise<HubDto[]> {
    const { id } = requireAccount(actor);
    await this.deps.hubs.setPersonalHubs(id, this.validate(solarSystemIds));
    return this.deps.queries.personalHubs(id);
  }

  /**
   * Gives a new map the trade hubs (`DEFAULT_MAP_HUBS`): the ones it lacks are added after the
   * hubs it has (an import may have set some already), up to the limit, and
   * `routes.hubs_changed` is published by the routing module itself. Returns the hubs added.
   */
  async addDefaultHubs(mapId: string): Promise<number[]> {
    return this.deps.uow.transaction(async () => {
      const current = await this.deps.hubs.mapHubs(mapId);
      const next = withDefaultHubs(current);
      if (!next) return [];
      const before = await this.deps.queries.mapHubs(mapId);
      await this.deps.hubs.setMapHubs(mapId, next);
      const hubs = await this.deps.queries.mapHubs(mapId);
      await this.deps.events.append([
        newEvent({
          stream: mapStream(mapId),
          type: 'routes.hubs_changed',
          actor: actorRef(ROUTING),
          data: { hubs },
          before: { hubs: before },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
      return next.slice(current.length);
    });
  }

  /**
   * Adds hubs to an account's own (an import bringing a Wanderer user's): missing ones after the
   * ones it has, up to the limit, unknown systems left out. Private to the account, so no event.
   */
  async addPersonalHubs(
    accountId: string,
    solarSystemIds: readonly number[],
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const current = await this.deps.hubs.personalHubs(accountId);
    const known = solarSystemIds.filter((id) => this.deps.universe.getSystem(id));
    const next = [...new Set([...current, ...known])].slice(0, MAX_HUBS);
    if (next.length === current.length) return 'unchanged';
    await this.deps.hubs.setPersonalHubs(accountId, next);
    return current.length === 0 ? 'created' : 'updated';
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.deps.hubs.forgetMap(mapId);
  }

  private validate(solarSystemIds: readonly number[]): number[] {
    const ids = [...new Set(solarSystemIds)];
    if (ids.length > MAX_HUBS) throw new ValidationError(`At most ${MAX_HUBS} hubs`);
    for (const id of ids) {
      if (!this.deps.universe.getSystem(id)) throw new ValidationError(`Unknown solar system ${id}`);
    }
    return ids;
  }
}

const ROUTING: Actor = { kind: 'system', id: 'routing' };

/**
 * Keeps every map's exits current: after a change to its chain or hubs, recomputes them and
 * publishes `routes.exits_changed` when they differ from what was published last.
 */
export class ExitsPublisher {
  private readonly published = new Map<string, string>();

  constructor(private readonly deps: { queries: RouteQueries; events: EventLog; clock: Clock }) {}

  async refresh(mapId: string): Promise<MapExitDto[] | null> {
    let exits: MapExitDto[];
    try {
      exits = await this.deps.queries.sharedExits(mapId);
    } catch (error) {
      // The map is gone.
      if (error instanceof NotFoundError) {
        this.published.delete(mapId);
        return null;
      }
      throw error;
    }
    const json = JSON.stringify(exits);
    const previous = this.published.get(mapId);
    if (previous === json) return null;
    await this.deps.events.append([
      newEvent({
        stream: mapStream(mapId),
        type: 'routes.exits_changed',
        actor: actorRef(ROUTING),
        data: { exits },
        ...(previous === undefined ? {} : { before: { exits: JSON.parse(previous) as MapExitDto[] } }),
        occurredAt: this.deps.clock.now(),
      }),
    ]);
    this.published.set(mapId, json);
    return exits;
  }

  forget(mapId: string): void {
    this.published.delete(mapId);
  }
}
