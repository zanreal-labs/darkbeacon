import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { singleProcess, type EventBus, type EventLog, type Leadership } from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import { PostgresEventBus } from '../adapters/cluster/postgres-event-bus.js';
import { PostgresLeadership } from '../adapters/cluster/postgres-leadership.js';
import { PostgresPresenceRelay } from '../adapters/cluster/postgres-presence-relay.js';
import type { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import type { AppConfig } from '../config/config.js';
import type { PresenceRelay } from '../realtime/presence.js';

/**
 * How this process works with the others of its instance, chosen by CLUSTER: the event bus
 * every module publishes to and subscribes on, the leadership that once-per-instance work
 * (poller, durable consumers, schedules) asks before it runs, and the relay that shares presence.
 * `none`: in process, always the leader, no relay. `postgres`: LISTEN/NOTIFY and an advisory
 * lock; nothing else changes.
 */
export class Cluster implements OnApplicationShutdown {
  private readonly logger = new Logger('Cluster');

  private constructor(
    readonly bus: EventBus,
    readonly leadership: Leadership,
    readonly presence: PresenceRelay | undefined,
    private readonly stop: () => Promise<void>,
  ) {}

  static async start(config: AppConfig, database: Database, local: InProcessEventBus): Promise<Cluster> {
    if (config.cluster !== 'postgres' || !config.databaseUrl) {
      return new Cluster(local, singleProcess, undefined, async () => {});
    }
    const logger = new Logger('Cluster');
    const scope = database.schema ?? 'public';
    const bus = new PostgresEventBus({
      url: config.databaseUrl,
      channel: scope === 'public' ? 'dbk_events' : `dbk_events_${scope}`,
      local,
      onError: (error) => logger.warn(`event bus: ${String(error)}`),
    });
    const presence = new PostgresPresenceRelay({
      url: config.databaseUrl,
      channel: scope === 'public' ? 'dbk_presence' : `dbk_presence_${scope}`,
      onError: (error) => logger.warn(`presence relay: ${String(error)}`),
    });
    const leadership = new PostgresLeadership({
      url: config.databaseUrl,
      name: `darkbeacon:leader:${scope}`,
      onError: (error) => logger.warn(`leadership: ${String(error)}`),
    });
    await bus.start();
    await presence.start();
    await leadership.start();
    leadership.onChange((leader) => logger.log(leader ? 'this replica leads' : 'this replica follows'));
    logger.log(`clustered on Postgres; ${leadership.isLeader() ? 'leading' : 'following'}`);
    return new Cluster(bus, leadership, presence, async () => {
      await leadership.stop();
      await presence.stop();
      await bus.stop();
    });
  }

  /** The event log is where other replicas' events are read from. */
  attach(log: EventLog): void {
    if (this.bus instanceof PostgresEventBus) {
      this.bus.useReader((stream, sinceSeq, limit) => log.readSince(stream, sinceSeq, limit));
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop().catch((error: unknown) => this.logger.warn(String(error)));
  }
}
