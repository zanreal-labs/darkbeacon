import type { DiscordNotifyKind, DiscordNotifySettings, PluginDatabase } from '@darkbeacon/plugin-sdk';
import type { Embed } from './describe.js';
import { withDefaults } from './settings.js';

interface Tables {
  discord_notify_config: {
    map_id: string;
    settings: string;
    target: string | null;
    target_label: string | null;
    updated_at: number;
  };
  discord_notify_outbox: {
    id: string;
    map_id: string;
    kind: string;
    mention: number;
    embed: string;
    status: string;
    attempts: number;
    created_at: number;
    next_attempt_at: number;
  };
  discord_notify_status: {
    map_id: string;
    last_sent_at: number | null;
    last_error: string | null;
    last_error_at: number | null;
  };
  discord_notify_memory: { map_id: string; key: string; value: string };
}

/** Where a map's messages go; the webhook URL only ever leaves the database sealed. */
export type Target =
  { kind: 'webhook'; url: string } | { kind: 'channel'; guildId: string; channelId: string };

export interface MapConfig {
  mapId: string;
  settings: DiscordNotifySettings;
  target: Target | null;
  targetLabel: string | null;
}

export interface OutboxRow {
  id: string;
  mapId: string;
  kind: DiscordNotifyKind;
  mention: boolean;
  embed: Embed;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
}

export interface Secrets {
  seal(text: string): string;
  open(sealed: string): string | null;
}

/** Keeps a sent or failed message this long (for the status line), then forgets it. */
const KEEP_MS = 24 * 60 * 60 * 1000;
/** The instance's own entries in the memory table. */
export const INSTANCE = '';

export class Store {
  constructor(
    private readonly database: PluginDatabase,
    private readonly secrets: Secrets,
  ) {}

  private get db() {
    return this.database.db<Tables>();
  }

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  async config(mapId: string): Promise<MapConfig | null> {
    const row = await this.db
      .selectFrom('discord_notify_config')
      .selectAll()
      .where('map_id', '=', mapId)
      .executeTakeFirst();
    return row ? this.toConfig(row) : null;
  }

  /** Maps with notifications switched on and somewhere to send them. */
  async activeConfigs(): Promise<MapConfig[]> {
    const rows = await this.db
      .selectFrom('discord_notify_config')
      .selectAll()
      .where('target', 'is not', null)
      .execute();
    return rows.map((r) => this.toConfig(r)).filter((c) => c.settings.enabled && c.target !== null);
  }

  async saveConfig(config: MapConfig, now: number): Promise<void> {
    const row = {
      map_id: config.mapId,
      settings: JSON.stringify(config.settings),
      target: config.target ? this.secrets.seal(JSON.stringify(config.target)) : null,
      target_label: config.targetLabel,
      updated_at: now,
    };
    const { map_id: _, ...update } = row;
    await this.db
      .insertInto('discord_notify_config')
      .values(row)
      .onConflict((oc) => oc.column('map_id').doUpdateSet(update))
      .execute();
  }

  /** Forgets everything about a deleted map. */
  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('discord_notify_config').where('map_id', '=', mapId).execute();
    await this.db.deleteFrom('discord_notify_outbox').where('map_id', '=', mapId).execute();
    await this.db.deleteFrom('discord_notify_status').where('map_id', '=', mapId).execute();
    await this.db.deleteFrom('discord_notify_memory').where('map_id', '=', mapId).execute();
  }

  async enqueue(rows: ReadonlyArray<Omit<OutboxRow, 'attempts' | 'nextAttemptAt'>>): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto('discord_notify_outbox')
      .values(
        rows.map((r) => ({
          id: r.id,
          map_id: r.mapId,
          kind: r.kind,
          mention: r.mention ? 1 : 0,
          embed: JSON.stringify(r.embed),
          status: 'pending',
          attempts: 0,
          created_at: r.createdAt,
          next_attempt_at: r.createdAt,
        })),
      )
      .execute();
  }

  /** Pending messages of every map, oldest first. */
  async pending(now: number, limit = 200): Promise<OutboxRow[]> {
    const rows = await this.db
      .selectFrom('discord_notify_outbox')
      .selectAll()
      .where('status', '=', 'pending')
      .where('next_attempt_at', '<=', now)
      .orderBy('created_at')
      .orderBy('id')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      mapId: r.map_id,
      kind: r.kind as DiscordNotifyKind,
      mention: Number(r.mention) === 1,
      embed: JSON.parse(r.embed) as Embed,
      attempts: Number(r.attempts),
      createdAt: Number(r.created_at),
      nextAttemptAt: Number(r.next_attempt_at),
    }));
  }

  async pendingCount(mapId: string): Promise<number> {
    const row = await this.db
      .selectFrom('discord_notify_outbox')
      .select((eb) => eb.fn.countAll<number | string>().as('n'))
      .where('map_id', '=', mapId)
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async markSent(ids: readonly string[], mapId: string, now: number): Promise<void> {
    if (ids.length > 0) {
      await this.db
        .updateTable('discord_notify_outbox')
        .set({ status: 'sent', next_attempt_at: now })
        .where('id', 'in', [...ids])
        .execute();
    }
    await this.saveStatus(mapId, { last_sent_at: now });
  }

  /** A failed attempt: retried at `retryAt`, or given up on (null). */
  async markFailed(
    rows: readonly OutboxRow[],
    mapId: string,
    error: string,
    now: number,
    retryAt: (row: OutboxRow) => number | null,
  ): Promise<void> {
    for (const row of rows) {
      const next = retryAt(row);
      await this.db
        .updateTable('discord_notify_outbox')
        .set({
          status: next === null ? 'failed' : 'pending',
          attempts: row.attempts + 1,
          next_attempt_at: next ?? now,
        })
        .where('id', '=', row.id)
        .execute();
    }
    await this.saveStatus(mapId, { last_error: error.slice(0, 500), last_error_at: now });
  }

  /** Puts messages back for later without counting an attempt (rate limits). */
  async postpone(ids: readonly string[], until: number): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .updateTable('discord_notify_outbox')
      .set({ next_attempt_at: until })
      .where('id', 'in', [...ids])
      .execute();
  }

  /** Drops messages that can no longer be sent (no target, switched off). */
  async drop(mapId: string): Promise<void> {
    await this.db
      .updateTable('discord_notify_outbox')
      .set({ status: 'failed' })
      .where('map_id', '=', mapId)
      .where('status', '=', 'pending')
      .execute();
  }

  async prune(now: number): Promise<void> {
    await this.db
      .deleteFrom('discord_notify_outbox')
      .where('status', '!=', 'pending')
      .where('next_attempt_at', '<', now - KEEP_MS)
      .execute();
  }

  async status(mapId: string): Promise<Tables['discord_notify_status'] | null> {
    const row = await this.db
      .selectFrom('discord_notify_status')
      .selectAll()
      .where('map_id', '=', mapId)
      .executeTakeFirst();
    return row ?? null;
  }

  async saveStatus(
    mapId: string,
    patch: Partial<Omit<Tables['discord_notify_status'], 'map_id'>>,
  ): Promise<void> {
    const current = (await this.status(mapId)) ?? {
      map_id: mapId,
      last_sent_at: null,
      last_error: null,
      last_error_at: null,
    };
    const row = { ...current, ...patch };
    const { map_id: _, ...update } = row;
    await this.db
      .insertInto('discord_notify_status')
      .values(row)
      .onConflict((oc) => oc.column('map_id').doUpdateSet(update))
      .execute();
  }

  async remember<T>(mapId: string, key: string): Promise<T | null> {
    const row = await this.db
      .selectFrom('discord_notify_memory')
      .select('value')
      .where('map_id', '=', mapId)
      .where('key', '=', key)
      .executeTakeFirst();
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async memorize(mapId: string, key: string, value: unknown): Promise<void> {
    await this.db
      .insertInto('discord_notify_memory')
      .values({ map_id: mapId, key, value: JSON.stringify(value) })
      .onConflict((oc) => oc.columns(['map_id', 'key']).doUpdateSet({ value: JSON.stringify(value) }))
      .execute();
  }

  async forget(mapId: string, key: string): Promise<void> {
    await this.db
      .deleteFrom('discord_notify_memory')
      .where('map_id', '=', mapId)
      .where('key', '=', key)
      .execute();
  }

  private toConfig(row: Tables['discord_notify_config']): MapConfig {
    const opened = row.target ? this.secrets.open(row.target) : null;
    return {
      mapId: row.map_id,
      settings: withDefaults(JSON.parse(row.settings) as Partial<DiscordNotifySettings>),
      target: opened ? (JSON.parse(opened) as Target) : null,
      targetLabel: row.target_label,
    };
  }
}
