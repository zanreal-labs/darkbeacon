import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  AccessRules,
  AccessService,
  InstanceSettingsService,
  type AccessRuleRepository,
  type AccessSubjectsSource,
} from '@darkbeacon/access';
import { hasMapRole, type Clock, type EventLog, type UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { AccountService, DiscordBotService, EveDirectoryService } from '@darkbeacon/identity';
import { isEventOfType } from '@darkbeacon/shared';
import {
  KyselyAccessRuleRepository,
  KyselyInstanceSettingsRepository,
} from '../../adapters/access/kysely-access.js';
import { IdentitySubjectDirectory } from '../../adapters/access/subject-directory.js';
import type { AppConfig } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { AccessRulesController, InstanceSettingsController } from './access.controller.js';
import { MapOwnershipRegistry } from './map-ownership.registry.js';

const RULES = 'access.AccessRuleRepository';

/**
 * Map roles, access rules and instance settings. Provides MAP_ACCESS (the authorization
 * service every module checks map roles with) and authorizes `map:<id>` realtime streams.
 * The mapping module feeds map ownership through `MapOwnershipRegistry.use(...)`.
 */
@Global()
@Module({
  controllers: [AccessRulesController, InstanceSettingsController],
  providers: [
    { provide: RULES, useFactory: (db: Database) => new KyselyAccessRuleRepository(db), inject: [Database] },
    MapOwnershipRegistry,
    {
      provide: AccessService,
      // Identity's AccountService is this module's AccessSubjectsSource.
      useFactory: (
        rules: AccessRuleRepository,
        subjects: AccessSubjectsSource,
        ownership: MapOwnershipRegistry,
      ) => new AccessService({ rules, subjects, ownership }),
      inject: [RULES, AccountService, MapOwnershipRegistry],
    },
    { provide: MAP_ACCESS, useExisting: AccessService },
    {
      provide: AccessRules,
      useFactory: (
        rules: AccessRuleRepository,
        access: AccessService,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
        eve: EveDirectoryService,
        accounts: AccountService,
        bot: DiscordBotService,
      ) =>
        new AccessRules({
          rules,
          access,
          uow,
          events,
          clock,
          directory: new IdentitySubjectDirectory(eve, accounts, bot),
        }),
      inject: [
        RULES,
        AccessService,
        UNIT_OF_WORK,
        EVENT_LOG,
        CLOCK,
        EveDirectoryService,
        AccountService,
        DiscordBotService,
      ],
    },
    {
      provide: InstanceSettingsService,
      useFactory: (
        db: Database,
        rules: AccessRuleRepository,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
        config: AppConfig,
      ) =>
        new InstanceSettingsService({
          settings: new KyselyInstanceSettingsRepository(db),
          rules,
          uow,
          events,
          clock,
          discordConfigured: config.discord !== null,
        }),
      inject: [Database, RULES, UNIT_OF_WORK, EVENT_LOG, CLOCK, APP_CONFIG],
    },
  ],
  exports: [MAP_ACCESS, AccessService, MapOwnershipRegistry, InstanceSettingsService],
})
export class AccessModule implements OnModuleInit {
  constructor(
    @Inject(RealtimeRegistry) private readonly realtime: RealtimeRegistry,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AccessRules) private readonly rules: AccessRules,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
  ) {}

  onModuleInit(): void {
    this.realtime.registerStream('map', {
      authorize: async (actor, mapId) =>
        actor !== null && hasMapRole(await this.access.roleOf(actor, mapId), 'viewer'),
    });
    this.consumers.register({
      name: 'access.removed-maps',
      streams: ['map'],
      types: ['map.removed'],
      handle: async (event) => {
        if (isEventOfType(event, 'map.removed')) await this.rules.forgetMap(event.data.id);
      },
    });
  }
}
