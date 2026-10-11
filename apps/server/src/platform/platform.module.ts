import {
  Global,
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { systemClock, type EventBus } from '@wormwright/core';
import { createDatabase, Database } from '@wormwright/db';
import { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from '../adapters/events/kysely-event-log.js';
import type { AppConfig } from '../config/config.js';
import { ActorGuard, ActorResolverRegistry } from './actor.js';
import { ApiExceptionFilter } from './http.js';
import { APP_CONFIG, CLOCK, EVENT_BUS, EVENT_LOG, UNIT_OF_WORK } from './tokens.js';

export interface PlatformOptions {
  /** Use this database instead of opening one from the config (tests). It is not closed on shutdown. */
  database?: Database;
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
 * Clock, EventLog, EventBus and the actor resolver registry.
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
        {
          provide: EVENT_BUS,
          useFactory: () =>
            new InProcessEventBus((error, event) =>
              logger.error(`handler failed for ${event.type} ${event.id}: ${String(error)}`),
            ),
        },
        {
          provide: EVENT_LOG,
          useFactory: (database: Database, bus: EventBus) => new KyselyEventLog(database, bus),
          inject: [Database, EVENT_BUS],
        },
        ActorResolverRegistry,
        { provide: APP_GUARD, useClass: ActorGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
      exports: [APP_CONFIG, Database, UNIT_OF_WORK, CLOCK, EVENT_BUS, EVENT_LOG, ActorResolverRegistry],
    };
  }
}
