import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * The event log doubles as the audit trail. Each event gets its audit record (actor with names
 * and character, channel, origin, field-level diff or removed snapshot), the id of the change it
 * reverts, and a hash chained per stream (`prev_hash` -> `hash`). Events written before this
 * migration keep nulls. `event_ref` finds events by what they touch (system, connection,
 * signature, account, character, map) for per-thing and per-person histories.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  await db.schema.alterTable('event_log').addColumn('audit', col.json).execute();
  await db.schema.alterTable('event_log').addColumn('revert_of', col.id).execute();
  await db.schema.alterTable('event_log').addColumn('prev_hash', col.text).execute();
  await db.schema.alterTable('event_log').addColumn('hash', col.text).execute();
  await db.schema.alterTable('event_stream').addColumn('head_hash', col.text).execute();

  await db.schema.createIndex('event_log_revert_of').on('event_log').column('revert_of').execute();
  await db.schema
    .createIndex('event_log_stream_time')
    .on('event_log')
    .columns(['stream', 'occurred_at'])
    .execute();

  await db.schema
    .createTable('event_ref')
    .addColumn('ref', col.text, (c) => c.notNull())
    .addColumn('stream', col.text, (c) => c.notNull())
    .addColumn('seq', 'bigint', (c) => c.notNull())
    .addColumn('occurred_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('event_ref_pk', ['ref', 'stream', 'seq'])
    .execute();
  await db.schema.createIndex('event_ref_event').on('event_ref').columns(['stream', 'seq']).execute();
  await db.schema.createIndex('event_ref_occurred_at').on('event_ref').column('occurred_at').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('event_ref').execute();
  await db.schema.dropIndex('event_log_stream_time').execute();
  await db.schema.dropIndex('event_log_revert_of').execute();
  await db.schema.alterTable('event_stream').dropColumn('head_hash').execute();
  for (const column of ['hash', 'prev_hash', 'revert_of', 'audit'])
    await db.schema.alterTable('event_log').dropColumn(column).execute();
}
