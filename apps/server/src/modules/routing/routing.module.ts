import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  newId,
  parseStream,
  type Clock,
  type EventBus,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { AccountService, CharacterService } from '@darkbeacon/identity';
import type { MappingPorts } from '@darkbeacon/mapping';
import {
  BridgeAdmin,
  BridgeEdgeSource,
  EVE_SCOUT_POLL_MS,
  ExitsPublisher,
  HubAdmin,
  RouteQueries,
  Router,
  RoutingSettings,
  TheraFeed,
  TRADE_HUBS,
  WayHomePublisher,
  Waypoints,
  type AllianceDirectory,
  type BridgeRepository,
  type CorporationStructures,
  type HubRepository,
  type PilotDirectory,
  type RoutingSettingsRepository,
  type RoutingUniverse,
  type StationCatalog,
  type WaypointGateway,
} from '@darkbeacon/routing';
import { isEventOfType, type RouteMode } from '@darkbeacon/shared';
import {
  EsiPilotDirectory,
  HttpWaypointGateway,
  MappingChainSource,
} from '../../adapters/routing/esi-adapters.js';
import {
  AccountAlliances,
  EsiCorporationStructures,
  EsiSovereignty,
  HttpEveScoutClient,
  NO_PINGS,
  StaticInvasionLookup,
  StaticStationCatalog,
} from '../../adapters/routing/external-adapters.js';
import { KyselyHubRepository } from '../../adapters/routing/kysely-hub-repository.js';
import {
  KyselyBridgeRepository,
  KyselyRoutingSettingsRepository,
} from '../../adapters/routing/kysely-routing-repositories.js';
import type { AppConfig } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  HTTP_FETCH,
  MAP_ACCESS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { RoutingController } from './routing.controller.js';
import { ROUTING_STATIONS } from './routing.tokens.js';

const HUB_REPOSITORY = 'HubRepository';
const BRIDGE_REPOSITORY = 'BridgeRepository';
const ROUTING_SETTINGS_REPOSITORY = 'RoutingSettingsRepository';
const PILOT_DIRECTORY = 'PilotDirectory';
const WAYPOINT_GATEWAY = 'WaypointGateway';
const CORPORATION_STRUCTURES = 'CorporationStructures';
const ALLIANCES = 'AllianceDirectory';
const STATIONS = ROUTING_STATIONS;

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Chain changes are gathered this long before exits are recomputed. */
const DEBOUNCE_MS = 250;
/** Modes whose hub tables are filled in the background after a change. */
const PRECOMPUTED: readonly RouteMode[] = ['safer', 'highsec', 'outlaw'];
/** The sovereignty map is looked at this often (and read again when an hour old). */
const SOVEREIGNTY_CHECK_MS = 10 * 60_000;

const userAgent = (config: AppConfig) => `Darkbeacon/${version} (+${config.publicUrl})`;

/**
 * Keeps routing current: drops a map's routing state when its chain, bridges or settings change,
 * recomputes and publishes its exits and way home (debounced), fills the hub tables of the other
 * modes in the background, adds `exits` to map snapshots, reads EVE-Scout's Thera and Turnur
 * holes and the sovereignty map on timers (not in tests), and forgets deleted maps.
 */
@Injectable()
export class RoutingRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Routing');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pollers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(Router) private readonly router: Router,
    @Inject(RouteQueries) private readonly queries: RouteQueries,
    @Inject(ExitsPublisher) private readonly publisher: ExitsPublisher,
    @Inject(WayHomePublisher) private readonly wayHome: WayHomePublisher,
    @Inject(HubAdmin) private readonly hubs: HubAdmin,
    @Inject(BridgeAdmin) private readonly bridges: BridgeAdmin,
    @Inject(RoutingSettings) private readonly settings: RoutingSettings,
    @Inject(TheraFeed) private readonly thera: TheraFeed,
    @Inject(EsiSovereignty) private readonly sovereignty: EsiSovereignty,
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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
        await this.bridges.forgetMap(event.data.id);
        await this.settings.forgetMap(event.data.id);
        this.router.invalidate(event.data.id);
        this.publisher.forget(event.data.id);
        this.wayHome.forget(event.data.id);
      },
    });
    this.unsubscribe = this.bus.subscribe(
      async (event) => {
        const stream = parseStream(event.stream);
        if (stream?.kind !== 'map') return;
        if (isEventOfType(event, 'system.updated')) {
          // Moves and notes do not change routes; showing or hiding a system and its status
          // (home) do.
          const chain = await this.router.chain(stream.id).catch(() => null);
          const known = chain?.systems.find((s) => s.solarSystemId === event.data.solarSystemId);
          if (
            chain &&
            chain.visible.has(event.data.solarSystemId) === event.data.visible &&
            (!known || known.status === undefined || known.status === event.data.status)
          )
            return;
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
          'routes.bridges_changed',
          'routes.settings_changed',
        ],
      },
    );
    if (this.config.env === 'test') return;
    const readEveScout = async () => {
      try {
        if (!(await this.thera.refresh())) return;
        // Every map with routing state routes over the new holes; way homes may change.
        const maps = this.router.activeMaps();
        this.router.invalidateAll();
        for (const mapId of maps) this.schedule(mapId);
      } catch (error) {
        this.logger.warn(`EVE-Scout: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const readSovereignty = async () => {
      try {
        if (await this.sovereignty.refresh()) this.router.invalidateAll();
      } catch (error) {
        this.logger.warn(`sovereignty map: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    setTimeout(() => void readEveScout(), 2_000).unref();
    setTimeout(() => void readSovereignty(), 5_000).unref();
    this.pollers.push(
      setInterval(() => void readEveScout(), EVE_SCOUT_POLL_MS).unref(),
      setInterval(() => void readSovereignty(), SOVEREIGNTY_CHECK_MS).unref(),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.pollers) clearInterval(timer);
    this.timers.clear();
  }

  private schedule(mapId: string): void {
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
      await this.wayHome.refresh(mapId);
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

/** Routes over stargates, the chain, jump bridges and Thera, hubs, exits, the way home and in-game waypoints. */
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
      provide: BRIDGE_REPOSITORY,
      useFactory: (database: Database) => new KyselyBridgeRepository(database),
      inject: [Database],
    },
    {
      provide: ROUTING_SETTINGS_REPOSITORY,
      useFactory: (database: Database) => new KyselyRoutingSettingsRepository(database),
      inject: [Database],
    },
    {
      provide: PILOT_DIRECTORY,
      useFactory: (config: AppConfig, characters: CharacterService, clock: Clock, fetchFn: typeof fetch) =>
        new EsiPilotDirectory({ characters, clock, fetch: fetchFn, userAgent: userAgent(config) }),
      inject: [APP_CONFIG, CharacterService, CLOCK, HTTP_FETCH],
    },
    {
      provide: WAYPOINT_GATEWAY,
      useFactory: (config: AppConfig, fetchFn: typeof fetch) =>
        new HttpWaypointGateway({ fetch: fetchFn, userAgent: userAgent(config) }),
      inject: [APP_CONFIG, HTTP_FETCH],
    },
    {
      provide: CORPORATION_STRUCTURES,
      useFactory: (config: AppConfig, characters: CharacterService, fetchFn: typeof fetch) =>
        new EsiCorporationStructures({
          fetch: fetchFn,
          userAgent: userAgent(config),
          scopes: (id) => characters.scopes(id),
          accessToken: (id) => characters.accessToken(id),
        }),
      inject: [APP_CONFIG, CharacterService, HTTP_FETCH],
    },
    {
      provide: ALLIANCES,
      useFactory: (characters: CharacterService, accounts: AccountService) =>
        new AccountAlliances({
          mainCharacterOf: async (id) => (await accounts.names([id])).get(id)?.mainCharacterId ?? null,
          charactersOf: async (id) =>
            (await characters.listForAccount(id)).map((c) => ({ id: c.id, allianceId: c.allianceId })),
        }),
      inject: [CharacterService, AccountService],
    },
    { provide: STATIONS, useFactory: () => StaticStationCatalog.load() },
    {
      provide: EsiSovereignty,
      useFactory: (config: AppConfig, clock: Clock, fetchFn: typeof fetch) =>
        new EsiSovereignty({ fetch: fetchFn, userAgent: userAgent(config), clock }),
      inject: [APP_CONFIG, CLOCK, HTTP_FETCH],
    },
    {
      provide: TheraFeed,
      useFactory: (config: AppConfig, universe: RoutingUniverse, clock: Clock, fetchFn: typeof fetch) =>
        new TheraFeed({
          client: new HttpEveScoutClient({ fetch: fetchFn, userAgent: userAgent(config) }),
          universe,
          clock,
        }),
      inject: [APP_CONFIG, UNIVERSE_CATALOG, CLOCK, HTTP_FETCH],
    },
    {
      provide: Router,
      useFactory: (
        universe: RoutingUniverse,
        ports: MappingPorts,
        bridges: BridgeRepository,
        thera: TheraFeed,
        sovereignty: EsiSovereignty,
      ) => {
        const router = new Router({
          universe,
          chains: new MappingChainSource(ports),
          invasion: StaticInvasionLookup.load(),
          sovereignty,
        });
        router.addEdgeSource(new BridgeEdgeSource(bridges));
        router.addEdgeSource(thera);
        return router;
      },
      inject: [UNIVERSE_CATALOG, MAPPING_PORTS, BRIDGE_REPOSITORY, TheraFeed, EsiSovereignty],
    },
    {
      provide: RouteQueries,
      useFactory: (
        router: Router,
        universe: RoutingUniverse,
        hubs: HubRepository,
        pilots: PilotDirectory,
        access: MapAccess,
        settings: RoutingSettingsRepository,
        alliances: AllianceDirectory,
        stations: StationCatalog,
        thera: TheraFeed,
      ) =>
        new RouteQueries({
          router,
          universe,
          hubs,
          pilots,
          access,
          settings,
          alliances,
          stations,
          thera,
          pings: NO_PINGS,
        }),
      inject: [
        Router,
        UNIVERSE_CATALOG,
        HUB_REPOSITORY,
        PILOT_DIRECTORY,
        MAP_ACCESS,
        ROUTING_SETTINGS_REPOSITORY,
        ALLIANCES,
        STATIONS,
        TheraFeed,
      ],
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
      provide: BridgeAdmin,
      useFactory: (
        bridges: BridgeRepository,
        universe: RoutingUniverse,
        structures: CorporationStructures,
        pilots: PilotDirectory,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new BridgeAdmin({ bridges, universe, structures, pilots, access, events, uow, clock, newId }),
      inject: [
        BRIDGE_REPOSITORY,
        UNIVERSE_CATALOG,
        CORPORATION_STRUCTURES,
        PILOT_DIRECTORY,
        MAP_ACCESS,
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
      ],
    },
    {
      provide: RoutingSettings,
      useFactory: (
        settings: RoutingSettingsRepository,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new RoutingSettings({ settings, access, events, uow, clock }),
      inject: [ROUTING_SETTINGS_REPOSITORY, MAP_ACCESS, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: ExitsPublisher,
      useFactory: (queries: RouteQueries, events: EventLog, clock: Clock) =>
        new ExitsPublisher({ queries, events, clock }),
      inject: [RouteQueries, EVENT_LOG, CLOCK],
    },
    {
      provide: WayHomePublisher,
      useFactory: (queries: RouteQueries, events: EventLog, clock: Clock) =>
        new WayHomePublisher({ queries, events, clock }),
      inject: [RouteQueries, EVENT_LOG, CLOCK],
    },
    {
      provide: Waypoints,
      useFactory: (
        pilots: PilotDirectory,
        gateway: WaypointGateway,
        universe: RoutingUniverse,
        stations: StationCatalog,
      ) => new Waypoints({ pilots, gateway, universe, stations }),
      inject: [PILOT_DIRECTORY, WAYPOINT_GATEWAY, UNIVERSE_CATALOG, STATIONS],
    },
    RoutingRuntime,
  ],
  exports: [Router],
})
export class RoutingModule {}
