import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Durable readers of event_log (webhooks, auto-mapping, cleanups). A consumer starts at the
  // heads of the streams that exist when it first runs; streams created later start at 0.
  await db.schema
    .createTable('event_consumer')
    .addColumn('name', col.text, (c) => c.primaryKey())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();

  // Last seq a consumer has handled, per stream.
  await db.schema
    .createTable('event_consumer_offset')
    .addColumn('consumer', col.text, (c) => c.notNull())
    .addColumn('stream', col.text, (c) => c.notNull())
    .addColumn('seq', 'bigint', (c) => c.notNull())
    .addPrimaryKeyConstraint('event_consumer_offset_pk', ['consumer', 'stream'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_consumer_offset').execute();
  await db.schema.dropTable('event_consumer').execute();
}
