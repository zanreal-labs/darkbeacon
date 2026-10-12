import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ApiKeys, type KeyOwnerDirectory, type MapNames } from '@darkbeacon/api-keys';
import type { Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { AccountService } from '@darkbeacon/identity';
import type { MapRepository } from '@darkbeacon/mapping';
import { HmacTokenSecrets, KyselyApiKeyRepository } from '../../adapters/api-keys/kysely-api-keys.js';
import type { AppConfig } from '../../config/config.js';
import { ActorResolverRegistry, isMcpPath } from '../../platform/actor.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK } from '../../platform/tokens.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAP_REPOSITORY } from '../mapping/mapping.tokens.js';
import { AdminApiKeysController, ApiKeysController } from './api-keys.controller.js';

/**
 * API keys: personal access tokens and service keys. Installs the bearer resolver, so
 * `Authorization: Bearer dbk_…` becomes an actor on HTTP, WebSocket and MCP requests (narrowed
 * by the key's scopes); without this module every bearer token is refused.
 */
@Global()
@Module({
  imports: [MappingModule],
  controllers: [ApiKeysController, AdminApiKeysController],
  providers: [
    {
      provide: ApiKeys,
      useFactory: (
        db: Database,
        config: AppConfig,
        accounts: AccountService,
        maps: MapRepository,
        access: MapAccess,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
      ) => {
        const owners: KeyOwnerDirectory = {
          find: async (accountId) => {
            const account = await accounts.find(accountId);
            if (!account) return null;
            const actor = await accounts.actorFor(account);
            return { id: account.id, name: account.name, instanceRole: actor.instanceRole };
          },
          names: async (ids) => new Map([...(await accounts.names(ids))].map(([id, a]) => [id, a.name])),
        };
        const mapNames: MapNames = {
          describe: async (ids) =>
            ids.length === 0
              ? []
              : (await maps.listByIds(ids)).map((m) => ({ id: m.id, name: m.name, slug: m.slug })),
        };
        return new ApiKeys({
          keys: new KyselyApiKeyRepository(db),
          secrets: new HmacTokenSecrets(config.secretKey),
          owners,
          maps: mapNames,
          access,
          uow,
          events,
          clock,
        });
      },
      inject: [
        Database,
        APP_CONFIG,
        AccountService,
        MAP_REPOSITORY,
        MAP_ACCESS,
        UNIT_OF_WORK,
        EVENT_LOG,
        CLOCK,
      ],
    },
  ],
  exports: [ApiKeys],
})
export class ApiKeysModule implements OnModuleInit {
  constructor(
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(ApiKeys) private readonly keys: ApiKeys,
  ) {}

  onModuleInit(): void {
    this.actors.useBearer(async (token, request) => {
      const channel = isMcpPath(request.url) ? 'mcp' : 'api';
      const resolved = await this.keys.authenticate(token, { ip: request.ip ?? null, channel });
      return {
        actor: resolved.actor,
        credentialId: resolved.keyId,
        rateLimitPerMinute: resolved.rateLimitPerMinute,
      };
    });
  }
}
