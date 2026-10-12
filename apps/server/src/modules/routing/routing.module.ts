import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  parseStream,
  type Clock,
  type EventBus,
  type EventLog,
  type Leadership,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { CharacterService } from '@darkbeacon/identity';
import type { MappingPorts } from '@darkbeacon/mapping';
import {
  ExitsPublisher,
  HubAdmin,
  RouteQueries,
  Router,
  TRADE_HUBS,
  Waypoints,
  type HubRepository,
  type PilotDirectory,
  type RoutingUniverse,
  type WaypointGateway,
} from '@darkbeacon/routing';
import { isEventOfType, type RouteMode } from '@darkbeacon/shared';
import {
  EsiPilotDirectory,
  HttpWaypointGateway,
  MappingChainSource,
} from '../../adapters/routing/esi-adapters.js';
import { KyselyHubRepository } from '../../adapters/routing/kysely-hub-repository.js';
import type { AppConfig } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  HTTP_FETCH,
  LEADERSHIP,
  MAP_ACCESS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { RoutingController } from './routing.controller.js';

const HUB_REPOSITORY = 'HubRepository';
const PILOT_DIRECTORY = 'PilotDirectory';
const WAYPOINT_GATEWAY = 'WaypointGateway';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Chain changes are gathered this long before exits are recomputed. */
const DEBOUNCE_MS = 250;
/** Modes whose hub tables are filled in the background after a change. */
const PRECOMPUTED: readonly RouteMode[] = ['safer', 'highsec', 'outlaw'];

/**
 * Keeps routing current: drops a map's routing state when its chain changes, recomputes and
 * publishes its exits (debounced), fills the hub tables of the other modes in the background,
 * adds `exits` to map snapshots and forgets deleted maps' hubs.
 */
@Injectable()
export class RoutingRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Routing');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(Router) private readonly router: Router,
    @Inject(RouteQueries) private readonly queries: RouteQueries,
    @Inject(ExitsPublisher) private readonly publisher: ExitsPublisher,
    @Inject(HubAdmin) private readonly hubs: HubAdmin,
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', async (mapId) => ({
      exits: await this.queries.sharedExits(mapId),
    }));
    this.consumers.register({
      name: 'routing.removed-maps',
      streams: ['map'],
      types: ['map.removed'],
      handle: async (event) => {
        if (!isEventOfType(event, 'map.removed')) return;
        await this.hubs.forgetMap(event.data.id);
        this.router.invalidate(event.data.id);
        this.publisher.forget(event.data.id);
      },
    });
    this.unsubscribe = this.bus.subscribe(
      async (event) => {
        const stream = parseStream(event.stream);
        if (stream?.kind !== 'map') return;
        if (isEventOfType(event, 'system.updated')) {
          // Moves and notes do not change routes; only showing or hiding a system does.
          const chain = await this.router.chain(stream.id).catch(() => null);
          if (chain && chain.visible.has(event.data.solarSystemId) === event.data.visible) return;
        }
        if (event.type !== 'routes.hubs_changed') this.router.invalidate(stream.id);
        this.schedule(stream.id);
      },
      {
        types: [
          'system.added',
          'system.updated',
          'system.removed',
          'connection.added',
          'connection.updated',
          'connection.removed',
          'routes.hubs_changed',
        ],
      },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Exits are published by one replica (the leader); every replica drops its routing state. */
  private schedule(mapId: string): void {
    if (!this.leadership.isLeader()) return;
    clearTimeout(this.timers.get(mapId));
    this.timers.set(
      mapId,
      setTimeout(() => {
        this.timers.delete(mapId);
        void this.refresh(mapId);
      }, DEBOUNCE_MS).unref(),
    );
  }

  private async refresh(mapId: string): Promise<void> {
    try {
      const exits = await this.publisher.refresh(mapId);
      if (exits === null && !(await this.router.chain(mapId))) return;
      const hubIds = [
        ...TRADE_HUBS.map((h) => h.solarSystemId),
        ...(await this.queries.mapHubs(mapId)).map((h) => h.solarSystemId),
      ];
      await this.router.precompute(mapId, hubIds, PRECOMPUTED);
    } catch (error) {
      this.logger.error(`routing of map ${mapId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Routes over stargates and the chain, hubs, exits and in-game waypoints. */
@Module({
  imports: [MappingModule],
  controllers: [RoutingController],
  providers: [
    {
      provide: HUB_REPOSITORY,
      useFactory: (database: Database) => new KyselyHubRepository(database),
      inject: [Database],
    },
    {
      provide: PILOT_DIRECTORY,
      useFactory: (config: AppConfig, characters: CharacterService, clock: Clock, fetchFn: typeof fetch) =>
        new EsiPilotDirectory({
          characters,
          clock,
          fetch: fetchFn,
          userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
          baseUrl: config.esiBaseUrl,
        }),
      inject: [APP_CONFIG, CharacterService, CLOCK, HTTP_FETCH],
    },
    {
      provide: WAYPOINT_GATEWAY,
      useFactory: (config: AppConfig, fetchFn: typeof fetch) =>
        new HttpWaypointGateway({
          fetch: fetchFn,
          userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
          baseUrl: config.esiBaseUrl,
        }),
      inject: [APP_CONFIG, HTTP_FETCH],
    },
    {
      provide: Router,
      useFactory: (universe: RoutingUniverse, ports: MappingPorts) =>
        new Router({ universe, chains: new MappingChainSource(ports) }),
      inject: [UNIVERSE_CATALOG, MAPPING_PORTS],
    },
    {
      provide: RouteQueries,
      useFactory: (
        router: Router,
        universe: RoutingUniverse,
        hubs: HubRepository,
        pilots: PilotDirectory,
        access: MapAccess,
      ) => new RouteQueries({ router, universe, hubs, pilots, access }),
      inject: [Router, UNIVERSE_CATALOG, HUB_REPOSITORY, PILOT_DIRECTORY, MAP_ACCESS],
    },
    {
      provide: HubAdmin,
      useFactory: (
        hubs: HubRepository,
        queries: RouteQueries,
        universe: RoutingUniverse,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new HubAdmin({ hubs, queries, universe, access, events, uow, clock }),
      inject: [HUB_REPOSITORY, RouteQueries, UNIVERSE_CATALOG, MAP_ACCESS, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: ExitsPublisher,
      useFactory: (queries: RouteQueries, events: EventLog, clock: Clock) =>
        new ExitsPublisher({ queries, events, clock }),
      inject: [RouteQueries, EVENT_LOG, CLOCK],
    },
    {
      provide: Waypoints,
      useFactory: (pilots: PilotDirectory, gateway: WaypointGateway, universe: RoutingUniverse) =>
        new Waypoints({ pilots, gateway, universe }),
      inject: [PILOT_DIRECTORY, WAYPOINT_GATEWAY, UNIVERSE_CATALOG],
    },
    RoutingRuntime,
  ],
  exports: [Router, RouteQueries],
})
export class RoutingModule {}
