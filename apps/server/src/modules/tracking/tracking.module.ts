import { readFileSync } from 'node:fs';
import { Logger, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AuditScope, Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  AutoMapper,
  ListMapCharacters,
  SetTracking,
  TrackingCleanup,
  TrackingPoller,
  type AutoMapTarget,
  type CharacterTokenSource,
  type EsiGateway,
  type TrackingRepository,
  type UniverseLookup,
} from '@darkbeacon/tracking';
import { ConnectionUseCases, SystemUseCases, type MappingPorts } from '@darkbeacon/mapping';
import { CharacterService } from '@darkbeacon/identity';
import { HttpEsiGateway } from '../../adapters/tracking/http-esi-gateway.js';
import { MappingAutoMapTarget } from '../../adapters/tracking/mapping-auto-map-target.js';
import { SharingAutoMapTarget } from '../../adapters/sharing/sharing-auto-map-target.js';
import { ChainMerger, ChainWrites } from '@darkbeacon/sharing';
import { KyselyTrackingRepository } from '../../adapters/tracking/kysely-tracking-repository.js';
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
import { MappingModule } from '../mapping/mapping.module.js';
import { MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { TrackingController } from './tracking.controller.js';
import { TrackingRuntime } from './tracking.runtime.js';

export const TRACKING_REPOSITORY = 'TrackingRepository';
export const ESI_GATEWAY = 'EsiGateway';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Character tracking: identity supplies character tokens (CharacterService), access answers
 * map roles and mapping records auto-mapped jumps.
 */
@Module({
  imports: [MappingModule],
  controllers: [TrackingController],
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
      provide: ESI_GATEWAY,
      useFactory: (config: AppConfig, clock: Clock) =>
        new HttpEsiGateway({ clock, userAgent: `Darkbeacon/${version} (+${config.publicUrl})` }),
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
      useFactory: (tracking: TrackingRepository, access: MapAccess) =>
        new ListMapCharacters({ tracking, access }),
      inject: [TRACKING_REPOSITORY, MAP_ACCESS],
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
          onError: (error, characterId) =>
            logger.error(`polling character ${characterId} failed: ${String(error)}`),
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
      ],
    },
    {
      provide: AutoMapper,
      useFactory: (
        tracking: TrackingRepository,
        access: MapAccess,
        target: AutoMapTarget,
        universe: UniverseLookup,
      ) => new AutoMapper({ tracking, access, target, universe }),
      inject: [TRACKING_REPOSITORY, MAP_ACCESS, AUTO_MAP_TARGET, UNIVERSE_CATALOG],
    },
    {
      provide: TrackingCleanup,
      useFactory: (
        tracking: TrackingRepository,
        characters: CharacterTokenSource,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => new TrackingCleanup({ tracking, characters, events, uow, clock }),
      inject: [TRACKING_REPOSITORY, CHARACTER_TOKENS, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
    TrackingRuntime,
  ],
  exports: [ListMapCharacters, TRACKING_REPOSITORY],
})
export class TrackingModule {}
