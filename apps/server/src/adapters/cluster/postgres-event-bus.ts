import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { DomainEvent, EventBus, EventFilter, EventHandler } from '@darkbeacon/core';
import { InProcessEventBus } from '../events/in-process-event-bus.js';

/** Reads committed events of a stream after `sinceSeq` (the event log). */
export type EventReader = (stream: string, sinceSeq: number, limit: number) => Promise<DomainEvent[]>;

export interface PostgresEventBusOptions {
  url: string;
  /** NOTIFY channel; replicas of one instance (one database and schema) share it. */
  channel: string;
  /** Local dispatch (handlers of this process). */
  local?: InProcessEventBus;
  onError?: (error: unknown) => void;
}

/** NOTIFY payloads must stay under 8000 bytes. */
const MAX_PAYLOAD = 7_000;
const READ_PAGE = 500;

interface Notice {
  /** The replica that committed the events (it already dispatched them itself). */
  from: string;
  /** [stream, first seq, last seq] of what was committed. */
  ranges: Array<[string, number, number]>;
}

/**
 * EventBus for replicas sharing one Postgres: events are dispatched to this process's handlers
 * at once, and announced to the other replicas with NOTIFY as stream ranges, never as the
 * events themselves (payloads are limited to 8 kB). A replica hearing of a range reads it from
 * the event log, so every replica sees every event, complete and in seq order per stream; the
 * realtime hub fills any gap from the log as it does for its own events.
 */
export class PostgresEventBus implements EventBus {
  readonly id = randomUUID();
  private readonly local: InProcessEventBus;
  private readonly pool: pg.Pool;
  private listener: pg.Client | null = null;
  private reader: EventReader | null = null;
  private stopped = false;
  /** Remote ranges are read one after the other, so per-stream order holds. */
  private queue: Promise<void> = Promise.resolve();
  private reconnect: NodeJS.Timeout | undefined;

  constructor(private readonly options: PostgresEventBusOptions) {
    this.local = options.local ?? new InProcessEventBus();
    this.pool = new pg.Pool({ connectionString: options.url, max: 2 });
    this.pool.on('error', (error) => options.onError?.(error));
  }

  /** The event log the ranges are read from (it needs the bus, so it comes after). */
  useReader(reader: EventReader): void {
    this.reader = reader;
  }

  async start(): Promise<void> {
    await this.listen();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnect);
    await this.listener?.end().catch(() => undefined);
    await this.queue;
    await this.pool.end().catch(() => undefined);
  }

  publish(events: readonly DomainEvent[]): void {
    this.local.publish(events);
    if (this.stopped || events.length === 0) return;
    const ranges = new Map<string, [string, number, number]>();
    for (const e of events) {
      const range = ranges.get(e.stream);
      if (!range) ranges.set(e.stream, [e.stream, e.seq, e.seq]);
      else {
        range[1] = Math.min(range[1], e.seq);
        range[2] = Math.max(range[2], e.seq);
      }
    }
    for (const payload of payloads(this.id, [...ranges.values()])) {
      this.pool
        .query('select pg_notify($1, $2)', [this.options.channel, payload])
        .catch((error: unknown) => this.options.onError?.(error));
    }
  }

  subscribe(handler: EventHandler, filter?: EventFilter): () => void {
    return this.local.subscribe(handler, filter);
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: this.options.url });
    client.on('notification', (message) => {
      if (message.channel === this.options.channel && message.payload) this.heard(message.payload);
    });
    const lost = (error: unknown) => {
      if (this.listener !== client) return;
      this.listener = null;
      if (error) this.options.onError?.(error);
      // Events committed meanwhile reach the hub through its gap filling and the consumers
      // through the log; only live fan-out of that moment is late.
      if (!this.stopped) this.reconnect = setTimeout(() => void this.listen().catch(lost), 1_000);
    };
    client.on('error', lost);
    client.on('end', () => lost(null));
    await client.connect();
    await client.query(`listen "${this.options.channel.replaceAll('"', '')}"`);
    this.listener = client;
  }

  private heard(payload: string): void {
    let notice: Notice;
    try {
      notice = JSON.parse(payload) as Notice;
    } catch {
      return;
    }
    if (notice.from === this.id || !this.reader) return;
    const reader = this.reader;
    this.queue = this.queue
      .then(async () => {
        for (const [stream, first, last] of notice.ranges) {
          let since = first - 1;
          while (since < last) {
            const events = (await reader(stream, since, READ_PAGE)).filter((e) => e.seq <= last);
            if (events.length === 0) break;
            this.local.publish(events);
            since = events.at(-1)!.seq;
          }
        }
      })
      .catch((error: unknown) => this.options.onError?.(error));
  }
}

/** Notices for these ranges, each under the payload limit. */
export function payloads(from: string, ranges: Array<[string, number, number]>): string[] {
  const out: string[] = [];
  let current: Array<[string, number, number]> = [];
  const text = (list: typeof current) => JSON.stringify({ from, ranges: list } satisfies Notice);
  for (const range of ranges) {
    if (current.length > 0 && text([...current, range]).length > MAX_PAYLOAD) {
      out.push(text(current));
      current = [];
    }
    current.push(range);
  }
  if (current.length > 0) out.push(text(current));
  return out;
}
