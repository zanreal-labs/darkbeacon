import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { BackupService } from '@darkbeacon/backups';
import { systemClock, type Clock, type EventLog } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { NotifierRegistry } from '@darkbeacon/notifications';
import type { FastifyInstance } from 'fastify';
import {
  backupConfig,
  createBackupService,
  HttpBackupNotifier,
  noMaintenance,
  noNotifier,
  scratchDirOf,
  type BackupConfig,
} from '../../adapters/backups/index.js';
import type { AppConfig } from '../../config/config.js';
import { onBeforeMigration } from '../../platform/database-hooks.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, HTTP_FETCH } from '../../platform/tokens.js';
import { APP_VERSION } from '../../platform/version.js';
import { BackupsController } from './backups.controller.js';
import { BACKUP_CONFIG, type BackupModuleConfig } from './backups.tokens.js';

/** How often the scheduler looks whether a backup is due. */
const TICK_MS = 60_000;
const ENV_CONFIG = 'BackupEnvConfig';

// Before pending migrations change an existing SQLite database, keep a copy of it. A failure is
// recorded (the Backups section shows it) but does not stop the server from starting.
onBeforeMigration(async ({ config, database, pending }) => {
  if (database.dialect !== 'sqlite' || !database.sqlite || database.sqlite.inMemory) return;
  const logger = new Logger('Backups');
  const service = createBackupService({
    config: backupConfig(process.env, config.dataDir),
    database,
    clock: systemClock,
    appVersion: APP_VERSION,
    events: null,
    maintenance: noMaintenance,
    notifier: noNotifier,
    onError: (error) => logger.warn(String(error)),
  });
  try {
    const backup = await service.backupBeforeMigration();
    if (backup) logger.log(`backed up before ${pending.length} migration(s): ${backup.name}`);
  } catch (error) {
    logger.error(
      `could not back up before migrating: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

/** Runs the scheduled backup when it is due; the service's lock keeps runs from overlapping. */
@Injectable()
export class BackupScheduler implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Backups');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(BackupService) private readonly backups: BackupService,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // Uploads are streamed by the restore route itself; Fastify must leave the body alone.
    const fastify = this.http.httpAdapter.getInstance<FastifyInstance>();
    if (!fastify.hasContentTypeParser('multipart/form-data')) {
      fastify.addContentTypeParser('multipart/form-data', (_request, _payload, done) => done(null));
    }
  }

  onApplicationBootstrap(): void {
    // Tests run the schedule themselves.
    if (this.config.env === 'test' || !this.backups.supported) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.maintenance.active) return;
    try {
      const backup = await this.backups.runScheduled();
      if (backup) this.logger.log(`scheduled backup ${backup.name}`);
    } catch (error) {
      this.logger.error(`scheduled backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * SQLite backups and restore (instance admins): the `backups` module over file adapters, the
 * scheduler, the admin routes and a backup before migrations at startup. On Postgres it only
 * answers that backups are made with Postgres tooling.
 */
@Module({
  controllers: [BackupsController],
  providers: [
    {
      provide: ENV_CONFIG,
      useFactory: (config: AppConfig): BackupConfig => backupConfig(process.env, config.dataDir),
      inject: [APP_CONFIG],
    },
    {
      provide: BACKUP_CONFIG,
      useFactory: (config: BackupConfig): BackupModuleConfig => ({
        dir: config.dir,
        scratchDir: scratchDirOf(config),
        maxUploadBytes: config.maxUploadBytes,
      }),
      inject: [ENV_CONFIG],
    },
    {
      provide: BackupService,
      useFactory: (
        env: BackupConfig,
        config: AppConfig,
        database: Database,
        clock: Clock,
        events: EventLog,
        maintenance: MaintenanceMode,
        fetch: (url: string, init?: RequestInit) => Promise<Response>,
        notifiers: NotifierRegistry | null,
      ) => {
        const logger = new Logger('Backups');
        const onError = (error: unknown) =>
          logger.warn(error instanceof Error ? error.message : String(error));
        return createBackupService({
          config: env,
          database,
          clock,
          appVersion: APP_VERSION,
          events,
          maintenance,
          notifier: new HttpBackupNotifier({
            ...(notifiers ? { core: (n) => notifiers.send(n) } : {}),
            fetch,
            instanceUrl: config.publicUrl,
            onError,
          }),
          onError,
        });
      },
      inject: [
        ENV_CONFIG,
        APP_CONFIG,
        Database,
        CLOCK,
        EVENT_LOG,
        MaintenanceMode,
        HTTP_FETCH,
        { token: NotifierRegistry, optional: true },
      ],
    },
    BackupScheduler,
  ],
  exports: [BackupService, BackupScheduler],
})
export class BackupsModule {}
