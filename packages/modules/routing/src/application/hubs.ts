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
import { MAX_HUBS } from '../domain/hubs.js';
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

  /** Replaces the map's hubs and publishes `routes.hubs_changed`. */
  async setMapHubs(actor: Actor | null, mapId: string, solarSystemIds: readonly number[]): Promise<HubDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
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
