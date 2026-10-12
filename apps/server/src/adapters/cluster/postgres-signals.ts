import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { LocalSignals, type Signals } from '@darkbeacon/core';

export interface PostgresSignalsOptions {
  url: string;
  /** NOTIFY channel; replicas of one instance share it. */
  channel: string;
  onError?: (error: unknown) => void;
}

/** NOTIFY payloads must stay under 8000 bytes. */
export const MAX_SIGNAL_PAYLOAD = 7_000;

/**
 * `Signals` between replicas over Postgres NOTIFY: delivered here at once, and to the other
 * replicas through the channel (each skips its own). A lost notification is a lost signal; what
 * they carry (pushes to viewers) is repeated by the next change.
 */
export class PostgresSignals implements Signals {
  private readonly origin = randomUUID();
  private readonly local: LocalSignals;
  private readonly pool: pg.Pool;
  private listener: pg.Client | null = null;
  private stopped = false;
  private reconnect: NodeJS.Timeout | undefined;

  constructor(private readonly options: PostgresSignalsOptions) {
    this.local = new LocalSignals(options.onError);
    this.pool = new pg.Pool({ connectionString: options.url, max: 2 });
    this.pool.on('error', (error) => options.onError?.(error));
  }

  async start(): Promise<void> {
    await this.listen();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnect);
    await this.listener?.end().catch(() => undefined);
    await this.pool.end().catch(() => undefined);
  }

  publish(topic: string, payload: unknown): void {
    this.local.publish(topic, payload);
    if (this.stopped) return;
    const text = JSON.stringify({ origin: this.origin, topic, payload });
    if (text.length > MAX_SIGNAL_PAYLOAD) {
      this.options.onError?.(new Error(`signal ${topic} too big for NOTIFY (${text.length} bytes)`));
      return;
    }
    this.pool
      .query('select pg_notify($1, $2)', [this.options.channel, text])
      .catch((error: unknown) => this.options.onError?.(error));
  }

  subscribe(topic: string, handler: (payload: unknown) => void): () => void {
    return this.local.subscribe(topic, handler);
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: this.options.url });
    client.on('notification', (message) => {
      if (message.channel !== this.options.channel || !message.payload) return;
      let signal: { origin?: string; topic?: string; payload?: unknown };
      try {
        signal = JSON.parse(message.payload) as typeof signal;
      } catch {
        return;
      }
      if (signal.origin === this.origin || typeof signal.topic !== 'string') return;
      this.local.publish(signal.topic, signal.payload);
    });
    const lost = (error: unknown) => {
      if (this.listener !== client) return;
      this.listener = null;
      if (error) this.options.onError?.(error);
      if (!this.stopped) this.reconnect = setTimeout(() => void this.listen().catch(lost), 1_000);
    };
    client.on('error', lost);
    client.on('end', () => lost(null));
    await client.connect();
    await client.query(`listen "${this.options.channel.replaceAll('"', '')}"`);
    this.listener = client;
  }
}
