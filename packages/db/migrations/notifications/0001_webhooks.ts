import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('webhook')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('url', col.text, (c) => c.notNull())
    .addColumn('events', col.json, (c) => c.notNull())
    // AES-256-GCM sealed signing secret.
    .addColumn('secret', col.text, (c) => c.notNull())
    .addColumn('enabled', col.boolean, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema.createIndex('webhook_map_id').on('webhook').column('map_id').execute();

  await db.schema
    .createTable('webhook_delivery')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('webhook_id', col.id, (c) => c.notNull())
    .addColumn('event_id', col.id, (c) => c.notNull())
    .addColumn('event_type', col.text, (c) => c.notNull())
    .addColumn('payload', col.text, (c) => c.notNull())
    .addColumn('attempt', col.integer, (c) => c.notNull())
    .addColumn('status', col.text, (c) => c.notNull())
    .addColumn('response_code', col.integer)
    .addColumn('error', col.text)
    .addColumn('next_attempt_at', col.timestamp)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('webhook_delivery_webhook')
    .on('webhook_delivery')
    .columns(['webhook_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('webhook_delivery_due')
    .on('webhook_delivery')
    .columns(['status', 'next_attempt_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('webhook_delivery').execute();
  await db.schema.dropTable('webhook').execute();
}
