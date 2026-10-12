import pg from 'pg';
import type { Leadership } from '@darkbeacon/core';

export interface PostgresLeadershipOptions {
  url: string;
  /** Lock name; replicas of one instance (one database and schema) share it. */
  name: string;
  /** How often a follower tries to take the lock and the leader checks its connection. */
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * Leader election with a Postgres session advisory lock (`pg_try_advisory_lock`) on a
 * connection of its own: the replica holding the lock is the leader until its connection ends
 * (crash, network loss: Postgres releases the lock), then another one takes it within
 * `intervalMs`. A leader that cannot reach Postgres steps down at once.
 */
export class PostgresLeadership implements Leadership {
  private client: pg.Client | null = null;
  private leader = false;
  private stopped = false;
  private readonly listeners = new Set<(leader: boolean) => void>();
  private timer: NodeJS.Timeout | undefined;
  private checking: Promise<void> | null = null;

  constructor(private readonly options: PostgresLeadershipOptions) {}

  /** Tries once right away (so a lone replica leads before it serves), then keeps trying. */
  async start(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 2_000);
    this.timer.unref();
  }

  isLeader(): boolean {
    return this.leader;
  }

  onChange(listener: (leader: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.checking;
    const client = this.client;
    this.client = null;
    this.set(false);
    if (client) {
      // Ending the session releases the lock; the next replica takes over on its next try.
      await client.end().catch(() => undefined);
    }
  }

  private check(): Promise<void> {
    this.checking ??= this.tryLead().finally(() => (this.checking = null));
    return this.checking;
  }

  private async tryLead(): Promise<void> {
    if (this.stopped) return;
    try {
      if (!this.client) {
        const client = new pg.Client({ connectionString: this.options.url });
        client.on('error', (error) => this.lost(client, error));
        client.on('end', () => this.lost(client, null));
        await client.connect();
        this.client = client;
      }
      if (this.leader) {
        await this.client.query('select 1');
        return;
      }
      const { rows } = await this.client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)) as locked',
        [this.options.name],
      );
      if (rows[0]?.locked) this.set(true);
    } catch (error) {
      if (this.client) this.lost(this.client, error);
      else this.options.onError?.(error);
    }
  }

  private lost(client: pg.Client, error: unknown): void {
    if (this.client !== client) return;
    this.client = null;
    if (error) this.options.onError?.(error);
    this.set(false);
    void client.end().catch(() => undefined);
  }

  private set(leader: boolean): void {
    if (this.leader === leader) return;
    this.leader = leader;
    for (const listener of this.listeners) {
      try {
        listener(leader);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
  }
}
