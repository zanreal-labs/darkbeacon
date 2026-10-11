import { readFileSync } from 'node:fs';
import { Logger, Module } from '@nestjs/common';
import type { Clock, EventLog, MapAccess, UnitOfWork } from '@wormwright/core';
import { Database } from '@wormwright/db';
import {
  AutoMapper,
  ListMapCharacters,
  SetTracking,
  TrackingPoller,
  type AutoMapTarget,
  type CharacterTokenSource,
  type EsiGateway,
  type TrackingRepository,
  type UniverseLookup,
} from '@wormwright/tracking';
import { HttpEsiGateway } from '../../adapters/tracking/http-esi-gateway.js';
import { KyselyTrackingRepository } from '../../adapters/tracking/kysely-tracking-repository.js';
import type { AppConfig } from '../../config/config.js';
import {
  APP_CONFIG,
  AUTO_MAP_TARGET,
  CHARACTER_TOKENS,
  CLOCK,
  EVENT_LOG,
  MAP_ACCESS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { TrackingController } from './tracking.controller.js';
import { TrackingRuntime } from './tracking.runtime.js';

export const TRACKING_REPOSITORY = 'TrackingRepository';
export const ESI_GATEWAY = 'EsiGateway';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Stand-ins while a port's provider is not installed: nothing is linked, nobody has access.
const noCharacters: CharacterTokenSource = {
  accessToken: () => Promise.resolve(null),
  character: () => Promise.resolve(null),
};
const noAccess: MapAccess = { roleOf: () => Promise.resolve(null), mapsFor: () => Promise.resolve([]) };
const optional = (token: string) => ({ token, optional: true });

/**
 * Character tracking. Needs CHARACTER_TOKENS (from identity), AUTO_MAP_TARGET (from mapping)
 * and MAP_ACCESS (from access) from global providers; without them it stays idle.
 */
@Module({
  controllers: [TrackingController],
  providers: [
    {
      provide: TRACKING_REPOSITORY,
      useFactory: (database: Database) => new KyselyTrackingRepository(database),
      inject: [Database],
    },
    {
      provide: ESI_GATEWAY,
      useFactory: (config: AppConfig, clock: Clock) =>
        new HttpEsiGateway({ clock, userAgent: `Wormwright/${version} (+${config.publicUrl})` }),
      inject: [APP_CONFIG, CLOCK],
    },
    {
      provide: SetTracking,
      useFactory: (
        tracking: TrackingRepository,
        characters: CharacterTokenSource | undefined,
        access: MapAccess | undefined,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) =>
        new SetTracking({
          tracking,
          characters: characters ?? noCharacters,
          access: access ?? noAccess,
          events,
          uow,
          clock,
        }),
      inject: [
        TRACKING_REPOSITORY,
        optional(CHARACTER_TOKENS),
        optional(MAP_ACCESS),
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
      ],
    },
    {
      provide: ListMapCharacters,
      useFactory: (tracking: TrackingRepository, access: MapAccess | undefined) =>
        new ListMapCharacters({ tracking, access: access ?? noAccess }),
      inject: [TRACKING_REPOSITORY, optional(MAP_ACCESS)],
    },
    {
      provide: TrackingPoller,
      useFactory: (
        tracking: TrackingRepository,
        characters: CharacterTokenSource | undefined,
        esi: EsiGateway,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
      ) => {
        const logger = new Logger('TrackingPoller');
        return new TrackingPoller({
          tracking,
          characters: characters ?? noCharacters,
          esi,
          events,
          uow,
          clock,
          onError: (error, characterId) =>
            logger.error(`polling character ${characterId} failed: ${String(error)}`),
        });
      },
      inject: [TRACKING_REPOSITORY, optional(CHARACTER_TOKENS), ESI_GATEWAY, EVENT_LOG, UNIT_OF_WORK, CLOCK],
    },
    {
      provide: AutoMapper,
      useFactory: (
        tracking: TrackingRepository,
        access: MapAccess | undefined,
        target: AutoMapTarget | undefined,
        universe: UniverseLookup,
      ) => (target ? new AutoMapper({ tracking, access: access ?? noAccess, target, universe }) : null),
      inject: [TRACKING_REPOSITORY, optional(MAP_ACCESS), optional(AUTO_MAP_TARGET), UNIVERSE_CATALOG],
    },
    TrackingRuntime,
  ],
})
export class TrackingModule {}
