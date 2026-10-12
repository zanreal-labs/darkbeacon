import {
  actorRef,
  mapStream,
  newEvent,
  NotFoundError,
  requireAccount,
  requireMapRole,
  type Actor,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import {
  DEFAULT_ROUTE_PREFERENCES,
  type MapRoutingSettingsDto,
  type RoutePreferencesDto,
  type UpdateMapRoutingSettingsRequest,
  type UpdateRoutePreferencesRequest,
  type WayHomeDto,
} from '@darkbeacon/shared';
import type { RoutingSettingsRepository } from '../ports/index.js';
import type { RouteQueries } from './routes.js';

/** What a map starts with: EVE-Scout's Thera and Turnur holes count. */
export const DEFAULT_MAP_ROUTING: MapRoutingSettingsDto = { thera: true };

export interface RoutingSettingsDeps {
  settings: RoutingSettingsRepository;
  access: MapAccess;
  events: EventLog;
  uow: UnitOfWork;
  clock: Clock;
}

/** The viewer's route options (the same on every map) and each map's own routing settings. */
export class RoutingSettings {
  constructor(private readonly deps: RoutingSettingsDeps) {}

  async preferences(actor: Actor | null): Promise<RoutePreferencesDto> {
    const { id } = requireAccount(actor);
    return { ...DEFAULT_ROUTE_PREFERENCES, ...(await this.deps.settings.preferences(id)) };
  }

  /** Private to the account, so no event. */
  async setPreferences(
    actor: Actor | null,
    patch: UpdateRoutePreferencesRequest,
  ): Promise<RoutePreferencesDto> {
    const current = await this.preferences(actor);
    const next: RoutePreferencesDto = {
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    next.skip = [...new Set(next.skip)];
    next.avoidSpace = [...new Set(next.avoidSpace)];
    next.avoid = [...new Set(next.avoid)];
    await this.deps.settings.setPreferences(requireAccount(actor).id, next, this.deps.clock.now());
    return next;
  }

  async mapSettings(actor: Actor | null, mapId: string): Promise<MapRoutingSettingsDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return this.of(mapId);
  }

  /** Changes the map's routing settings (managers) and publishes `routes.settings_changed`. */
  async setMapSettings(
    actor: Actor | null,
    mapId: string,
    patch: UpdateMapRoutingSettingsRequest,
  ): Promise<MapRoutingSettingsDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'manager');
    return this.deps.uow.transaction(async () => {
      const before = await this.of(mapId);
      const next: MapRoutingSettingsDto = {
        ...before,
        ...(patch.thera === undefined ? {} : { thera: patch.thera }),
      };
      if (next.thera === before.thera) return before;
      await this.deps.settings.setMapSettings(mapId, next, this.deps.clock.now());
      await this.deps.events.append([
        newEvent({
          stream: mapStream(mapId),
          type: 'routes.settings_changed',
          actor: actorRef(actor!),
          data: next,
          before,
          occurredAt: this.deps.clock.now(),
        }),
      ]);
      return next;
    });
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.deps.settings.forgetMap(mapId);
  }

  private async of(mapId: string): Promise<MapRoutingSettingsDto> {
    return { ...DEFAULT_MAP_ROUTING, ...(await this.deps.settings.mapSettings(mapId)) };
  }
}

const ROUTING: Actor = { kind: 'system', id: 'routing' };

/**
 * Keeps every map's way home current: after a change to its chain, hubs, bridges or settings (and
 * when EVE-Scout's holes change), recomputes it and publishes `routes.way_home_changed` when it
 * differs from what was published last.
 */
export class WayHomePublisher {
  private readonly published = new Map<string, string>();

  constructor(private readonly deps: { queries: RouteQueries; events: EventLog; clock: Clock }) {}

  async refresh(mapId: string): Promise<WayHomeDto | null> {
    let wayHome: WayHomeDto;
    try {
      wayHome = await this.deps.queries.wayHome(mapId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.published.delete(mapId);
        return null;
      }
      throw error;
    }
    const json = JSON.stringify(wayHome);
    const previous = this.published.get(mapId);
    if (previous === json) return null;
    // Nothing to say and nothing said yet: a map without a home stays quiet.
    if (previous === undefined && wayHome.home === null) {
      this.published.set(mapId, json);
      return null;
    }
    await this.deps.events.append([
      newEvent({
        stream: mapStream(mapId),
        type: 'routes.way_home_changed',
        actor: actorRef(ROUTING),
        data: wayHome,
        ...(previous === undefined ? {} : { before: JSON.parse(previous) as WayHomeDto }),
        occurredAt: this.deps.clock.now(),
      }),
    ]);
    this.published.set(mapId, json);
    return wayHome;
  }

  forget(mapId: string): void {
    this.published.delete(mapId);
  }
}
