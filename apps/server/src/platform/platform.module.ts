import {
  Global,
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditStamper } from '@darkbeacon/audit';
import { systemClock, type EventBus } from '@darkbeacon/core';
import { createDatabase, Database } from '@darkbeacon/db';
import { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from '../adapters/events/kysely-event-log.js';
import type { AppConfig } from '../config/config.js';
import { ActorGuard, ActorResolverRegistry } from './actor.js';
import { AsyncAuditScope, AuditContextInterceptor, AuditDirectoryRegistry } from './audit.js';
import { Cluster } from './cluster.js';
import { EventConsumers } from './event-consumers.js';
import { SignInCookies } from './sign-in-cookies.js';
import { ApiExceptionFilter } from './http.js';
import {
  APP_CONFIG,
  AUDIT_SCOPE,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  HTTP_FETCH,
  LEADERSHIP,
  UNIT_OF_WORK,
} from './tokens.js';

export interface PlatformOptions {
  /** Use this database instead of opening one from the config (tests). It is not closed on shutdown. */
  database?: Database;
  /** Outgoing HTTP for adapters (Discord, EVE SSO, ESI, webhooks); tests pass a fake network. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(Database) private readonly database: Database,
    private readonly owned: boolean,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.owned) await this.database.close();
  }
}

/**
 * Global infrastructure every feature module can inject: config, Database (= UnitOfWork),
 * Clock, EventLog, EventBus, durable event consumers, the actor resolver registry and the audit
 * scope and directory the event log records actors with.
 */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(config: AppConfig, options: PlatformOptions = {}): DynamicModule {
    const logger = new Logger('Events');
    return {
      module: PlatformModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: Database,
          useFactory: async () => {
            const database =
              options.database ??
              (await createDatabase({ url: config.databaseUrl, dataDir: config.dataDir }));
            const applied = await database.migrate();
            if (applied.length > 0) new Logger('Database').log(`applied migrations: ${applied.join(', ')}`);
            return database;
          },
        },
        {
          provide: DatabaseLifecycle,
          useFactory: (database: Database) => new DatabaseLifecycle(database, !options.database),
          inject: [Database],
        },
        { provide: UNIT_OF_WORK, useExisting: Database },
        { provide: CLOCK, useValue: systemClock },
        { provide: HTTP_FETCH, useValue: options.fetch ?? globalThis.fetch.bind(globalThis) },
        {
          provide: Cluster,
          useFactory: (database: Database, scope: AsyncAuditScope) =>
            Cluster.start(
              config,
              database,
              new InProcessEventBus(
                (error, event) =>
                  logger.error(`handler failed for ${event.type} ${event.id}: ${String(error)}`),
                (dispatch) => scope.detached(dispatch),
              ),
            ),
          inject: [Database, AsyncAuditScope],
        },
        { provide: EVENT_BUS, useFactory: (cluster: Cluster) => cluster.bus, inject: [Cluster] },
        { provide: LEADERSHIP, useFactory: (cluster: Cluster) => cluster.leadership, inject: [Cluster] },
        AsyncAuditScope,
        { provide: AUDIT_SCOPE, useExisting: AsyncAuditScope },
        AuditDirectoryRegistry,
        {
          provide: EVENT_LOG,
          useFactory: (
            database: Database,
            bus: EventBus,
            scope: AsyncAuditScope,
            directory: AuditDirectoryRegistry,
            cluster: Cluster,
          ) => {
            const log = new KyselyEventLog(database, bus, { scope, stamper: new AuditStamper(directory) });
            cluster.attach(log);
            return log;
          },
          inject: [Database, EVENT_BUS, AsyncAuditScope, AuditDirectoryRegistry, Cluster],
        },
        ActorResolverRegistry,
        EventConsumers,
        SignInCookies,
        { provide: APP_GUARD, useClass: ActorGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
      exports: [
        APP_CONFIG,
        Database,
        UNIT_OF_WORK,
        CLOCK,
        EVENT_BUS,
        EVENT_LOG,
        LEADERSHIP,
        HTTP_FETCH,
        ActorResolverRegistry,
        EventConsumers,
        SignInCookies,
        AsyncAuditScope,
        AUDIT_SCOPE,
        AuditDirectoryRegistry,
        Cluster,
      ],
    };
  }
}
