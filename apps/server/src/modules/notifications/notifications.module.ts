import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { InstanceSettingsService } from '@wormwright/access';
import type { Clock, EventBus, MapAccess } from '@wormwright/core';
import { Database } from '@wormwright/db';
import { NotifierRegistry, WebhookAdmin, WebhookDispatcher } from '@wormwright/notifications';
import { HttpWebhookSender } from '../../adapters/notifications/http-webhook-sender.js';
import { KyselyWebhookRepository } from '../../adapters/notifications/kysely-webhook-repository.js';
import { SecretBox } from '../../adapters/notifications/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, CLOCK, EVENT_BUS, MAP_ACCESS } from '../../platform/tokens.js';
import { WebhooksController } from './webhooks.controller.js';

const RETRY_EVERY_MS = 5_000;
const PRUNE_EVERY_MS = 60 * 60_000;
const KEEP_DELIVERIES_MS = 30 * 24 * 60 * 60_000;

/** Subscribes the dispatcher to the bus and resends failed deliveries on a timer. */
@Injectable()
export class WebhookWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Webhooks');
  private readonly cleanups: Array<() => void> = [];

  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(KyselyWebhookRepository) private readonly webhooks: KyselyWebhookRepository,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.cleanups.push(
      this.bus.subscribe((event) => this.dispatcher.handle(event)),
      every(RETRY_EVERY_MS, () => this.dispatcher.retryDue(), this.logger),
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
 * The Notifier registry (global, plugins add channels to it) and per-map webhooks: a core
 * subscriber of the EventBus that signs, sends and retries deliveries.
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
      useFactory: (webhooks: KyselyWebhookRepository, clock: Clock, settings: InstanceSettingsService) => {
        const sender = new HttpWebhookSender({
          allowPrivate: async () => (await settings.current()).webhooksToPrivateNetworks,
        });
        return new WebhookDispatcher({ webhooks, sender, clock });
      },
      inject: [KyselyWebhookRepository, CLOCK, InstanceSettingsService],
    },
    {
      provide: WebhookAdmin,
      useFactory: (
        webhooks: KyselyWebhookRepository,
        dispatcher: WebhookDispatcher,
        clock: Clock,
        access: MapAccess,
      ) => new WebhookAdmin({ webhooks, dispatcher, clock, access }),
      inject: [KyselyWebhookRepository, WebhookDispatcher, CLOCK, MAP_ACCESS],
    },
    WebhookWorker,
  ],
  exports: [NotifierRegistry],
})
export class NotificationsModule {}
