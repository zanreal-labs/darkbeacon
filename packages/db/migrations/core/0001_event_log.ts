import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Head seq per stream, kept separately so pruning event_log never reuses a seq.
  await db.schema
    .createTable('event_stream')
    .addColumn('stream', col.text, (c) => c.primaryKey())
    .addColumn('head_seq', 'bigint', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('event_log')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('stream', col.text, (c) => c.notNull())
    .addColumn('seq', 'bigint', (c) => c.notNull())
    .addColumn('type', col.text, (c) => c.notNull())
    .addColumn('occurred_at', col.timestamp, (c) => c.notNull())
    .addColumn('actor_kind', col.text, (c) => c.notNull())
    .addColumn('actor_id', col.text, (c) => c.notNull())
    .addColumn('data', col.json, (c) => c.notNull())
    .addColumn('v', col.integer, (c) => c.notNull())
    .addUniqueConstraint('event_log_stream_seq', ['stream', 'seq'])
    .execute();

  await db.schema.createIndex('event_log_occurred_at').on('event_log').column('occurred_at').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_log').execute();
  await db.schema.dropTable('event_stream').execute();
}
