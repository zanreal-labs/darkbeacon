import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import type { Clock, EventLog, Leadership, MapAccess, UnitOfWork } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { NotifierRegistry, WebhookAdmin, WebhookDispatcher } from '@darkbeacon/notifications';
import type { DomainTelemetry } from '@darkbeacon/observability';
import { isEventOfType, isMergedCopy } from '@darkbeacon/shared';
import { countingDeliveries, HttpWebhookSender } from '../../adapters/notifications/http-webhook-sender.js';
import { KyselyWebhookRepository } from '../../adapters/notifications/kysely-webhook-repository.js';
import { SecretBox } from '../../adapters/notifications/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_LOG,
  LEADERSHIP,
  MAP_ACCESS,
  OBSERVABILITY,
  UNIT_OF_WORK,
} from '../../platform/tokens.js';
import { WebhooksController } from './webhooks.controller.js';

const RETRY_EVERY_MS = 5_000;
const PRUNE_EVERY_MS = 60 * 60_000;
const KEEP_DELIVERIES_MS = 30 * 24 * 60 * 60_000;

/**
 * Queues deliveries from a durable event-log consumer, so a crash or restart between a commit
 * and its deliveries loses nothing, and resends failed deliveries on a timer.
 */
@Injectable()
export class WebhookWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Webhooks');
  private readonly cleanups: Array<() => void> = [];

  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(WebhookAdmin) private readonly admin: WebhookAdmin,
    @Inject(KyselyWebhookRepository) private readonly webhooks: KyselyWebhookRepository,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
  ) {}

  onModuleInit(): void {
    this.consumers.register({
      name: 'webhooks',
      streams: ['map'],
      handle: async (event) => {
        // No webhook outlives its map, and none is told about the deletion.
        if (isEventOfType(event, 'map.removed')) return this.admin.forgetMap(event.data.id);
        // A map that merges others: its webhooks hear its own changes, not the merged copies.
        if (isMergedCopy(event)) return;
        const queued = await this.dispatcher.queue(event);
        return queued.length > 0 ? () => this.dispatcher.send(queued) : undefined;
      },
    });
    this.cleanups.push(
      every(
        RETRY_EVERY_MS,
        // Retries go out from one replica only (the leader), never twice.
        () =>
          this.maintenance.active || !this.leadership.isLeader()
            ? Promise.resolve()
            : this.dispatcher.retryDue(),
        this.logger,
      ),
      every(
        PRUNE_EVERY_MS,
        () => this.webhooks.pruneDeliveries(this.clock.now() - KEEP_DELIVERIES_MS),
        this.logger,
      ),
    );
  }

  onApplicationShutdown(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

function every(ms: number, work: () => Promise<unknown>, logger: Logger): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    work()
      .catch((error: unknown) => logger.error(error instanceof Error ? error.message : String(error)))
      .finally(() => (running = false));
  }, ms);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * The Notifier registry (global, plugins add channels to it) and per-map webhooks: a durable
 * consumer of the event log that signs, sends and retries deliveries.
 */
@Global()
@Module({
  controllers: [WebhooksController],
  providers: [
    {
      provide: NotifierRegistry,
      useFactory: () => {
        const logger = new Logger('Notifier');
        return new NotifierRegistry((error, notifier) =>
          logger.error(`${notifier.id}: ${error instanceof Error ? error.message : String(error)}`),
        );
      },
    },
    {
      provide: KyselyWebhookRepository,
      useFactory: (database: Database, config: AppConfig) =>
        new KyselyWebhookRepository(database, new SecretBox(config.secretKey, 'webhook-secret')),
      inject: [Database, APP_CONFIG],
    },
    {
      provide: WebhookDispatcher,
      useFactory: (
        webhooks: KyselyWebhookRepository,
        clock: Clock,
        settings: InstanceSettingsService,
        telemetry?: DomainTelemetry | null,
      ) => {
        const http = new HttpWebhookSender({
          allowPrivate: async () => (await settings.current()).webhooksToPrivateNetworks,
        });
        const sender = telemetry
          ? countingDeliveries(http, (ok) => telemetry.notificationDelivered('webhook', ok))
          : http;
        return new WebhookDispatcher({ webhooks, sender, clock });
      },
      inject: [
        KyselyWebhookRepository,
        CLOCK,
        InstanceSettingsService,
        { token: OBSERVABILITY, optional: true },
      ],
    },
    {
      provide: WebhookAdmin,
      useFactory: (
        webhooks: KyselyWebhookRepository,
        dispatcher: WebhookDispatcher,
        clock: Clock,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
      ) => new WebhookAdmin({ webhooks, dispatcher, clock, access, events, uow }),
      inject: [KyselyWebhookRepository, WebhookDispatcher, CLOCK, MAP_ACCESS, EVENT_LOG, UNIT_OF_WORK],
    },
    WebhookWorker,
  ],
  exports: [NotifierRegistry],
})
export class NotificationsModule {}
