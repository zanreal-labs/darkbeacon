import pg from 'pg';
import type { PresenceBroadcast, PresenceRelay, RelayedPeer } from '../../realtime/presence.js';

export interface PostgresPresenceRelayOptions {
  url: string;
  /** NOTIFY channel; replicas of one instance share it. */
  channel: string;
  onError?: (error: unknown) => void;
}

/** NOTIFY payloads must stay under 8000 bytes. */
const MAX_PAYLOAD = 7_000;

/**
 * Presence between replicas over Postgres NOTIFY: a broadcast too big for one notification is
 * split by peers. Presence is ephemeral, so a lost notification only means a cursor is late until
 * the next change or the periodic repeat (RELAY_REFRESH_MS).
 */
export class PostgresPresenceRelay implements PresenceRelay {
  private readonly pool: pg.Pool;
  private listener: pg.Client | null = null;
  private readonly handlers = new Set<(broadcast: PresenceBroadcast) => void>();
  private stopped = false;
  private reconnect: NodeJS.Timeout | undefined;

  constructor(private readonly options: PostgresPresenceRelayOptions) {
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

  publish(broadcast: PresenceBroadcast): void {
    if (this.stopped) return;
    for (const payload of split(broadcast)) {
      this.pool
        .query('select pg_notify($1, $2)', [this.options.channel, payload])
        .catch((error: unknown) => this.options.onError?.(error));
    }
  }

  subscribe(handler: (broadcast: PresenceBroadcast) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: this.options.url });
    client.on('notification', (message) => {
      if (message.channel !== this.options.channel || !message.payload) return;
      let broadcast: PresenceBroadcast;
      try {
        broadcast = JSON.parse(message.payload) as PresenceBroadcast;
      } catch {
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(broadcast);
        } catch (error) {
          this.options.onError?.(error);
        }
      }
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

/** One broadcast as notifications under the payload limit: the left keys first, then peers. */
export function split(broadcast: PresenceBroadcast): string[] {
  const whole = JSON.stringify(broadcast);
  if (whole.length <= MAX_PAYLOAD) return [whole];
  const out: string[] = [];
  let peers: RelayedPeer[] = [];
  let left = broadcast.left;
  const text = (list: RelayedPeer[], gone: string[]) =>
    JSON.stringify({ ...broadcast, peers: list, left: gone } satisfies PresenceBroadcast);
  for (const peer of broadcast.peers) {
    if (peers.length > 0 && text([...peers, peer], left).length > MAX_PAYLOAD) {
      out.push(text(peers, left));
      peers = [];
      left = [];
    }
    peers.push(peer);
  }
  out.push(text(peers, left));
  return out;
}
