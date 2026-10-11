import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  AccessRules,
  AccessService,
  InstanceSettingsService,
  type AccessRuleRepository,
  type AccessSubjectsSource,
} from '@wormwright/access';
import { hasMapRole, type Clock, type EventLog, type UnitOfWork } from '@wormwright/core';
import { Database } from '@wormwright/db';
import { AccountService } from '@wormwright/identity';
import {
  KyselyAccessRuleRepository,
  KyselyInstanceSettingsRepository,
} from '../../adapters/access/kysely-access.js';
import { CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK } from '../../platform/tokens.js';
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
      ) => new AccessRules({ rules, access, uow, events, clock }),
      inject: [RULES, AccessService, UNIT_OF_WORK, EVENT_LOG, CLOCK],
    },
    {
      provide: InstanceSettingsService,
      useFactory: (db: Database, rules: AccessRuleRepository, uow: UnitOfWork) =>
        new InstanceSettingsService({ settings: new KyselyInstanceSettingsRepository(db), rules, uow }),
      inject: [Database, RULES, UNIT_OF_WORK],
    },
  ],
  exports: [MAP_ACCESS, AccessService, MapOwnershipRegistry, InstanceSettingsService],
})
export class AccessModule implements OnModuleInit {
  constructor(
    @Inject(RealtimeRegistry) private readonly realtime: RealtimeRegistry,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    this.realtime.registerStream('map', {
      authorize: async (actor, mapId) =>
        actor !== null && hasMapRole(await this.access.roleOf(actor, mapId), 'viewer'),
    });
  }
}
