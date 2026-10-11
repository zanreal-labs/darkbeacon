import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Clock, EventBus, MapAccess } from '@wormwright/core';
import { Database } from '@wormwright/db';
import { NotifierRegistry, WebhookAdmin, WebhookDispatcher } from '@wormwright/notifications';
import { FetchWebhookSender } from '../../adapters/notifications/fetch-webhook-sender.js';
import { KyselyWebhookRepository } from '../../adapters/notifications/kysely-webhook-repository.js';
import { SecretBox } from '../../adapters/notifications/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, CLOCK, EVENT_BUS, MAP_ACCESS } from '../../platform/tokens.js';
import { WebhooksController } from './webhooks.controller.js';

const RETRY_EVERY_MS = 5_000;
const PRUNE_EVERY_MS = 60 * 60_000;
const KEEP_DELIVERIES_MS = 30 * 24 * 60 * 60_000;

/** Without the access module nobody can see a map, so every webhook route answers 404. */
const noMapAccess: MapAccess = {
  roleOf: () => Promise.resolve(null),
  mapsFor: () => Promise.resolve([]),
};

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
      useFactory: (webhooks: KyselyWebhookRepository, clock: Clock) =>
        new WebhookDispatcher({ webhooks, sender: new FetchWebhookSender(), clock }),
      inject: [KyselyWebhookRepository, CLOCK],
    },
    {
      provide: WebhookAdmin,
      useFactory: (
        webhooks: KyselyWebhookRepository,
        dispatcher: WebhookDispatcher,
        clock: Clock,
        access: MapAccess | undefined,
      ) => new WebhookAdmin({ webhooks, dispatcher, clock, access: access ?? noMapAccess }),
      inject: [KyselyWebhookRepository, WebhookDispatcher, CLOCK, { token: MAP_ACCESS, optional: true }],
    },
    WebhookWorker,
  ],
  exports: [NotifierRegistry],
})
export class NotificationsModule {}
