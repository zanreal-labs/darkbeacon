// Tables of the discord-notify plugin. Portable types only (text, integer, bigint) so the same
// migration runs on SQLite and Postgres.
import type { PluginMigration } from '@darkbeacon/plugin-sdk';

type Db = Parameters<PluginMigration['up']>[0];

export async function up(db: Db): Promise<void> {
  // Per map: settings (JSON) and the target, its webhook URL sealed with the plugin's key.
  await db.schema
    .createTable('discord_notify_config')
    .addColumn('map_id', 'text', (c) => c.primaryKey())
    .addColumn('settings', 'text', (c) => c.notNull())
    .addColumn('target', 'text')
    .addColumn('target_label', 'text')
    .addColumn('updated_at', 'bigint', (c) => c.notNull())
    .execute();

  // Messages waiting for their batch, a retry, or kept a while as sent/failed.
  await db.schema
    .createTable('discord_notify_outbox')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('map_id', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('mention', 'integer', (c) => c.notNull())
    .addColumn('embed', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .addColumn('next_attempt_at', 'bigint', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('discord_notify_outbox_due')
    .on('discord_notify_outbox')
    .columns(['status', 'next_attempt_at'])
    .execute();

  await db.schema
    .createTable('discord_notify_status')
    .addColumn('map_id', 'text', (c) => c.primaryKey())
    .addColumn('last_sent_at', 'bigint')
    .addColumn('last_error', 'text')
    .addColumn('last_error_at', 'bigint')
    .execute();

  // What the plugin remembers about a map to tell changes apart (a connection's flags, a
  // system's status, the last way-home digest).
  await db.schema
    .createTable('discord_notify_memory')
    .addColumn('map_id', 'text', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('value', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('discord_notify_memory_pk', ['map_id', 'key'])
    .execute();
}
