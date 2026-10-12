import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  INSTANCE_STREAM,
  matchesFilter,
  type Clock,
  type DomainEvent,
  type EventBus,
  type EventLog,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import type { EventTables } from '../adapters/events/kysely-event-log.js';
import { CLOCK, EVENT_BUS, EVENT_LOG } from './tokens.js';

/** A reader of the event log that resumes where it stopped, also after a crash or restart. */
export interface EventConsumer {
  /** Stable name; the cursor is stored under it. */
  name: string;
  /** Stream kinds it reads: `instance`, `map`... */
  streams: readonly string[];
  /** Exact types or `prefix.*`; every event when omitted. */
  types?: readonly string[];
  /**
   * Runs inside the transaction that moves the cursor past the event, so its writes and the
   * cursor commit together. May return work (such as network calls) to run after the commit.
   */
  handle(event: DomainEvent): Promise<void | (() => Promise<void>)>;
}

interface ConsumerTables extends EventTables {
  event_consumer: { name: string; created_at: number };
  event_consumer_offset: { consumer: string; stream: string; seq: number };
}

const PAGE = 200;
/** Events a consumer handles in one transaction (one at a time again when a batch fails). */
const BATCH = 25;
/** Catch-up interval besides the bus wake-ups (missed wake-ups, retries after failures). */
const POLL_MS = 5_000;
/** An event a consumer keeps failing on is skipped after this many tries, so it cannot block the stream. */
const MAX_TRIES = 5;

/**
 * Runs the registered consumers over `event_log`, the outbox: modules register in
 * `onModuleInit`, consumers start once the application is up. The EventBus only wakes them:
 * an event wakes the consumers that want it, for its stream only; every POLL_MS all consumers
 * catch up on every stream (missed wake-ups, retries). Events are handled in small batches, one
 * transaction each.
 */
@Injectable()
export class EventConsumers implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly consumers: EventConsumer[] = [];
  /** Consumers whose cursor exists; only those are drained. */
  private readonly ready = new Set<EventConsumer>();
  private readonly failures = new Map<string, number>();
  private readonly logger = new Logger('EventConsumers');
  private running: Promise<void> | null = null;
  /** A full catch-up is asked for. */
  private again = false;
  /** Streams with new events per consumer that wants them, since the last run. */
  private pending = new Map<EventConsumer, Set<string>>();
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  register(consumer: EventConsumer): void {
    if (this.consumers.some((c) => c.name === consumer.name)) {
      throw new Error(`event consumer ${consumer.name} is registered twice`);
    }
    this.consumers.push(consumer);
    // Registered while running (a plugin loaded later): start it once its cursor exists.
    if (!this.stopped) {
      void this.init(consumer)
        .then(() => {
          this.ready.add(consumer);
          return this.wake();
        })
        .catch((error: unknown) => this.logger.error(`${consumer.name}: ${message(error)}`));
    }
  }

  /** Stops a consumer; its cursor is kept, so registering it again resumes where it stopped. */
  unregister(name: string): void {
    const index = this.consumers.findIndex((c) => c.name === name);
    if (index === -1) return;
    const [consumer] = this.consumers.splice(index, 1);
    this.ready.delete(consumer!);
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const consumer of this.consumers) {
      await this.init(consumer);
      this.ready.add(consumer);
    }
    this.stopped = false;
    this.unsubscribe = this.bus.subscribe((event) => void this.notify(event));
    this.timer = setInterval(() => void this.wake(), POLL_MS).unref();
    await this.wake();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.unsubscribe?.();
    await this.running;
  }

  /** Lets every consumer catch up; resolves once they have (calls during a run join it). */
  wake(): Promise<void> {
    this.again = true;
    return this.run();
  }

  /** A new event: the consumers that want it catch up on its stream. */
  private notify(event: DomainEvent): Promise<void> {
    const kind = event.stream === INSTANCE_STREAM ? INSTANCE_STREAM : event.stream.split(':')[0];
    let any = false;
    for (const consumer of this.ready) {
      if (!consumer.streams.includes(kind!)) continue;
      if (!matchesFilter(event, consumer.types ? { types: consumer.types } : undefined)) continue;
      let streams = this.pending.get(consumer);
      if (!streams) this.pending.set(consumer, (streams = new Set()));
      streams.add(event.stream);
      any = true;
    }
    return any ? this.run() : Promise.resolve();
  }

  private run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = (async () => {
      while (!this.stopped && (this.again || this.pending.size > 0)) {
        const full = this.again;
        const pending = this.pending;
        this.again = false;
        this.pending = new Map();
        for (const consumer of [...this.consumers]) {
          if (this.stopped) return;
          if (!this.ready.has(consumer)) continue;
          const streams = full ? null : pending.get(consumer);
          if (!full && !streams) continue;
          await (streams ? this.drainStreams(consumer, streams) : this.drain(consumer)).catch(
            (error: unknown) => this.logger.error(`${consumer.name}: ${message(error)}`),
          );
        }
      }
    })().finally(() => (this.running = null));
    return this.running;
  }

  private get db() {
    return this.database.db<ConsumerTables>();
  }

  /** A new consumer starts at the current heads: it handles what happens from now on. */
  private async init(consumer: EventConsumer): Promise<void> {
    await this.database.transaction(async () => {
      const known = await this.db
        .selectFrom('event_consumer')
        .select('name')
        .where('name', '=', consumer.name)
        .executeTakeFirst();
      if (known) return;
      await this.db
        .insertInto('event_consumer')
        .values({ name: consumer.name, created_at: this.clock.now() })
        .execute();
      const heads = await this.streamsOf(consumer).select(['stream', 'head_seq']).execute();
      for (let i = 0; i < heads.length; i += PAGE) {
        await this.db
          .insertInto('event_consumer_offset')
          .values(
            heads
              .slice(i, i + PAGE)
              .map((h) => ({ consumer: consumer.name, stream: h.stream, seq: h.head_seq })),
          )
          .execute();
      }
    });
  }

  private streamsOf(consumer: EventConsumer) {
    return this.db
      .selectFrom('event_stream')
      .where((eb) =>
        eb.or(
          consumer.streams.map((kind) =>
            kind === INSTANCE_STREAM
              ? eb('event_stream.stream', '=', INSTANCE_STREAM)
              : eb('event_stream.stream', 'like', `${kind}:%`),
          ),
        ),
      );
  }

  private async drain(consumer: EventConsumer): Promise<void> {
    const behind = await this.streamsOf(consumer)
      .leftJoin('event_consumer_offset as o', (join) =>
        join.onRef('o.stream', '=', 'event_stream.stream').on('o.consumer', '=', consumer.name),
      )
      .select(['event_stream.stream', 'event_stream.head_seq', 'o.seq'])
      .where((eb) => eb('event_stream.head_seq', '>', eb.fn.coalesce('o.seq', eb.lit(0))))
      .execute();
    for (const { stream, head_seq, seq } of behind) {
      if (this.stopped) return;
      await this.drainStream(consumer, stream, Number(seq ?? 0), Number(head_seq));
    }
  }

  /** Catches up on these streams only (they just got events this consumer wants). */
  private async drainStreams(consumer: EventConsumer, streams: ReadonlySet<string>): Promise<void> {
    const rows = await this.db
      .selectFrom('event_stream')
      .leftJoin('event_consumer_offset as o', (join) =>
        join.onRef('o.stream', '=', 'event_stream.stream').on('o.consumer', '=', consumer.name),
      )
      .select(['event_stream.stream', 'event_stream.head_seq', 'o.seq'])
      .where('event_stream.stream', 'in', [...streams])
      .execute();
    for (const { stream, head_seq, seq } of rows) {
      if (this.stopped) return;
      if (Number(head_seq) > Number(seq ?? 0))
        await this.drainStream(consumer, stream, Number(seq ?? 0), Number(head_seq));
    }
  }

  private async drainStream(
    consumer: EventConsumer,
    stream: string,
    from: number,
    head: number,
  ): Promise<void> {
    let offset = from;
    while (offset < head && !this.stopped) {
      const events = await this.log.readSince(stream, offset, PAGE);
      if (events.length === 0) {
        // Pruned before this consumer got to it.
        await this.save(consumer, stream, head);
        return;
      }
      const wanted = events.filter((event) =>
        matchesFilter(event, consumer.types ? { types: consumer.types } : undefined),
      );
      for (let i = 0; i < wanted.length; i += BATCH) {
        if (this.stopped) return;
        const batch = wanted.slice(i, i + BATCH);
        if (await this.handleBatch(consumer, batch)) continue;
        // Something in the batch failed: one at a time, so only the failing event waits.
        for (const event of batch) {
          if (this.stopped) return;
          // A failed event is retried on the next wake-up; the rest of the stream waits for it.
          if (!(await this.handle(consumer, event))) return;
        }
      }
      offset = events.at(-1)!.seq;
      // Moves past the events this consumer ignores (handled ones saved their own seq).
      await this.save(consumer, stream, offset);
    }
  }

  /**
   * Handles several events in one transaction that also moves the cursor past the last one.
   * False when any of them failed; nothing of the batch is kept then.
   */
  private async handleBatch(consumer: EventConsumer, events: readonly DomainEvent[]): Promise<boolean> {
    if (events.length < 2) return false;
    let after: Array<() => Promise<void>>;
    try {
      after = await this.database.transaction(async () => {
        const work: Array<() => Promise<void>> = [];
        for (const event of events) {
          const next = await consumer.handle(event);
          if (next) work.push(next);
        }
        await this.save(consumer, events.at(-1)!.stream, events.at(-1)!.seq);
        return work;
      });
    } catch {
      return false;
    }
    for (const event of events) this.failures.delete(`${consumer.name}:${event.id}`);
    for (const work of after) {
      work().catch((error: unknown) =>
        this.logger.error(`${consumer.name} after a batch: ${message(error)}`),
      );
    }
    return true;
  }

  /** Handles one event and moves the cursor in the same transaction. False: retry later. */
  private async handle(consumer: EventConsumer, event: DomainEvent): Promise<boolean> {
    const key = `${consumer.name}:${event.id}`;
    let after: void | (() => Promise<void>);
    try {
      after = await this.database.transaction(async () => {
        const work = await consumer.handle(event);
        await this.save(consumer, event.stream, event.seq);
        return work;
      });
      this.failures.delete(key);
    } catch (error) {
      const tries = (this.failures.get(key) ?? 0) + 1;
      this.failures.set(key, tries);
      if (tries < MAX_TRIES) {
        this.logger.warn(
          `${consumer.name} failed on ${event.type} ${event.id} (${tries}/${MAX_TRIES}): ${message(error)}`,
        );
        return false;
      }
      this.failures.delete(key);
      this.logger.error(
        `${consumer.name} skips ${event.type} ${event.id} after ${tries} tries: ${message(error)}`,
      );
      await this.save(consumer, event.stream, event.seq);
      return true;
    }
    if (after) {
      after().catch((error: unknown) =>
        this.logger.error(`${consumer.name} after ${event.type}: ${message(error)}`),
      );
    }
    return true;
  }

  private async save(consumer: EventConsumer, stream: string, seq: number): Promise<void> {
    await this.db
      .insertInto('event_consumer_offset')
      .values({ consumer: consumer.name, stream, seq })
      .onConflict((oc) => oc.columns(['consumer', 'stream']).doUpdateSet({ seq }))
      .execute();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
