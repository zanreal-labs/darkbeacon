import { readFileSync } from 'node:fs';
import { Logger, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AuditScope, Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  AutoMapper,
  CharacterActivity,
  ListMapCharacters,
  MapCharacterSettingsUseCases,
  ServerStatusWatch,
  ManageMapTracking,
  SetTracking,
  TrackingCleanup,
  TrackingPoller,
  type AutoMapTarget,
  type BridgeLookup,
  type CharacterTokenSource,
  type EsiGateway,
  type TrackingProblemStore,
  type TrackingRepository,
  type UniverseLookup,
} from '@darkbeacon/tracking';
import {
  ConnectionUseCases,
  MapUseCases,
  SystemUseCases,
  type MapRepository,
  type MappingPorts,
} from '@darkbeacon/mapping';
import { CharacterService } from '@darkbeacon/identity';
import { BucketBudget, TokenBuckets } from '../../adapters/rate-limit/token-buckets.js';
import { HttpEsiGateway } from '../../adapters/tracking/http-esi-gateway.js';
import { RealtimeMapViewers } from '../../adapters/tracking/realtime-map-viewers.js';
import { MappingAutoMapTarget } from '../../adapters/tracking/mapping-auto-map-target.js';
import { SharingAutoMapTarget } from '../../adapters/sharing/sharing-auto-map-target.js';
import { ChainMerger, ChainWrites } from '@darkbeacon/sharing';
import {
  KyselyMapCharacterSettings,
  KyselyTrackingProblems,
  KyselyTrackingRepository,
} from '../../adapters/tracking/kysely-tracking-repository.js';
import { KyselyActivityReader } from '../../adapters/tracking/kysely-activity-reader.js';
import { HttpServerStatus } from '../../adapters/tracking/http-server-status.js';
import { RoutingBridgeLookup } from '../../adapters/tracking/routing-bridge-lookup.js';
import { KyselyBridgeRepository } from '../../adapters/routing/kysely-routing-repositories.js';
import type { AppConfig } from '../../config/config.js';
import {
  APP_CONFIG,
  AUDIT_SCOPE,
  AUTO_MAP_TARGET,
  CHARACTER_TOKENS,
  CLOCK,
  EVENT_LOG,
  MAP_ACCESS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeHub } from '../../realtime/realtime.hub.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAP_REPOSITORY, MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { CharactersController } from './characters.controller.js';
import { TrackingOverview } from './my-tracking.js';
import { OfflineVisibility } from './offline-visibility.js';
import { TrackingController } from './tracking.controller.js';
import { TrackingRuntime } from './tracking.runtime.js';

export const TRACKING_REPOSITORY = 'TrackingRepository';
export const ESI_GATEWAY = 'EsiGateway';
/**
 * ESI requests per second the poller may send, over all characters: about 1,100 online
 * characters at 0.42 requests a second each (location and ship every 5 s, online every 60 s)
 * next to 1,000 offline ones (online every 60 s). Beyond that every character is polled a little
 * less often, maps someone has open first. See docs/scaling.md for the arithmetic.
 */
export const ESI_REQUESTS_PER_SECOND = 500;
export { MAP_CHARACTER_SETTINGS } from './tracking.tokens.js';
import { MAP_CHARACTER_SETTINGS } from './tracking.tokens.js';
const BRIDGE_LOOKUP = 'tracking.BridgeLookup';
const TRACKING_PROBLEMS = 'tracking.TrackingProblems';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Character tracking: identity supplies character tokens (CharacterService), access answers
 * map roles and mapping records auto-mapped jumps.
 */
@Module({
  imports: [MappingModule],
  controllers: [TrackingController, CharactersController],
  providers: [
    { provide: CHARACTER_TOKENS, useExisting: CharacterService },
    {
      provide: AUTO_MAP_TARGET,
      useFactory: (
        ports: MappingPorts,
        systems: SystemUseCases,
        connections: ConnectionUseCases,
        audit: AuditScope,
        tracking: TrackingRepository,
        modules: ModuleRef,
      ) =>
        // Sharing depends on tracking, so its services are looked up once the application runs.
        new SharingAutoMapTarget(
          new MappingAutoMapTarget(ports, systems, connections, audit),
          () => {
            try {
              return {
                merger: modules.get(ChainMerger, { strict: false }),
                writes: modules.get(ChainWrites, { strict: false }),
              };
            } catch {
              return null;
            }
          },
          tracking,
          audit,
        ),
      inject: [
        MAPPING_PORTS,
        SystemUseCases,
        ConnectionUseCases,
        AUDIT_SCOPE,
        TRACKING_REPOSITORY,
        ModuleRef,
      ],
    },
    {
      provide: TRACKING_REPOSITORY,
      useFactory: (database: Database) => new KyselyTrackingRepository(database),
      inject: [Database],
    },
    {
      provide: TRACKING_PROBLEMS,
      useFactory: (database: Database) => new KyselyTrackingProblems(database),
      inject: [Database],
    },
    {
      provide: ESI_GATEWAY,
      useFactory: (config: AppConfig, clock: Clock) =>
        new HttpEsiGateway({
          clock,
          userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
          baseUrl: config.esiBaseUrl,
        }),
      inject: [APP_CONFIG, CLOCK],
    },
    {
      provide: SetTracking,
      useFactory: (
        tracking: TrackingRepository,
        characters: CharacterTokenSource,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new SetTracking({ tracking, characters, access, events, uow, clock }),
      inject: [TRACKING_REPOSITORY, CHARACTER_TOKENS, MAP_ACCESS, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: ListMapCharacters,
      useFactory: (tracking: TrackingRepository, access: MapAccess, characters: CharacterTokenSource) =>
        new ListMapCharacters({ tracking, access, characters }),
      inject: [TRACKING_REPOSITORY, MAP_ACCESS, CHARACTER_TOKENS],
    },
    {
      provide: MAP_CHARACTER_SETTINGS,
      useFactory: (database: Database) => new KyselyMapCharacterSettings(database),
      inject: [Database],
    },
    {
      provide: MapCharacterSettingsUseCases,
      useFactory: (
        settings: KyselyMapCharacterSettings,
        characters: CharacterTokenSource,
        access: MapAccess,
        clock: Clock,
      ) => new MapCharacterSettingsUseCases({ settings, characters, access, clock }),
      inject: [MAP_CHARACTER_SETTINGS, CHARACTER_TOKENS, MAP_ACCESS, CLOCK],
    },
    {
      provide: CharacterActivity,
      useFactory: (
        database: Database,
        characters: CharacterTokenSource,
        tracking: TrackingRepository,
        access: MapAccess,
        clock: Clock,
      ) =>
        new CharacterActivity({
          activity: new KyselyActivityReader(database),
          characters,
          tracking,
          access,
          clock,
        }),
      inject: [Database, CHARACTER_TOKENS, TRACKING_REPOSITORY, MAP_ACCESS, CLOCK],
    },
    {
      provide: ServerStatusWatch,
      useFactory: (config: AppConfig, clock: Clock) =>
        new ServerStatusWatch({
          source: new HttpServerStatus({
            userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
            baseUrl: config.esiBaseUrl,
          }),
          clock,
        }),
      inject: [APP_CONFIG, CLOCK],
    },
    {
      provide: TrackingOverview,
      useFactory: (
        characters: CharacterService,
        maps: MapUseCases,
        tracking: TrackingRepository,
        problems: TrackingProblemStore,
      ) => new TrackingOverview({ characters, maps, tracking, problems }),
      inject: [CharacterService, MapUseCases, TRACKING_REPOSITORY, TRACKING_PROBLEMS],
    },
    {
      provide: BRIDGE_LOOKUP,
      useFactory: (database: Database) => new RoutingBridgeLookup(new KyselyBridgeRepository(database)),
      inject: [Database],
    },
    {
      provide: ManageMapTracking,
      useFactory: (
        tracking: TrackingRepository,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new ManageMapTracking({ tracking, access, events, uow, clock }),
      inject: [TRACKING_REPOSITORY, MAP_ACCESS, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: OfflineVisibility,
      useFactory: (maps: MapRepository, access: MapAccess, tracking: TrackingRepository) =>
        new OfflineVisibility(maps, access, tracking),
      inject: [MAP_REPOSITORY, MAP_ACCESS, TRACKING_REPOSITORY],
    },
    {
      provide: TrackingPoller,
      useFactory: (
        tracking: TrackingRepository,
        characters: CharacterTokenSource,
        access: MapAccess,
        esi: EsiGateway,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
        hub: RealtimeHub,
        problems: TrackingProblemStore,
      ) => {
        const logger = new Logger('TrackingPoller');
        return new TrackingPoller({
          tracking,
          characters,
          access,
          esi,
          events,
          uow,
          clock,
          budget: new BucketBudget(new TokenBuckets(() => clock.now()), 'esi', ESI_REQUESTS_PER_SECOND),
          viewers: new RealtimeMapViewers(hub),
          onError: (error, characterId) =>
            logger.error(`polling character ${characterId} failed: ${String(error)}`),
          problems,
          // Once per change, so a character that cannot be read does not flood the log.
          onProblem: (characterId, problem) =>
            problem
              ? logger.warn(`character ${characterId}: cannot read its location: ${problem.message}`)
              : logger.log(`character ${characterId}: reading its location again`),
        });
      },
      inject: [
        TRACKING_REPOSITORY,
        CHARACTER_TOKENS,
        MAP_ACCESS,
        ESI_GATEWAY,
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
        RealtimeHub,
        TRACKING_PROBLEMS,
      ],
    },
    {
      provide: AutoMapper,
      useFactory: (
        tracking: TrackingRepository,
        access: MapAccess,
        target: AutoMapTarget,
        universe: UniverseLookup,
        bridges: BridgeLookup,
      ) => new AutoMapper({ tracking, access, target, universe, bridges }),
      inject: [TRACKING_REPOSITORY, MAP_ACCESS, AUTO_MAP_TARGET, UNIVERSE_CATALOG, BRIDGE_LOOKUP],
    },
    {
      provide: TrackingCleanup,
      useFactory: (
        tracking: TrackingRepository,
        characters: CharacterTokenSource,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
        problems: TrackingProblemStore,
      ) => new TrackingCleanup({ tracking, characters, events, uow, clock, problems }),
      inject: [TRACKING_REPOSITORY, CHARACTER_TOKENS, EVENT_LOG, UNIT_OF_WORK, CLOCK, TRACKING_PROBLEMS],
    },
    TrackingRuntime,
  ],
  exports: [ListMapCharacters, TRACKING_REPOSITORY],
})
export class TrackingModule {}
