import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * The support hub signs pilots in with the app's own session instead of its own EVE sign-in
 * (docs/support.md). That sign-in kept no table (its session was a sealed cookie), but its unread
 * handles belonged to one character's support identity; a handle now shows the unread answers of
 * a hub account (every character of it). Handles made under the old sign-in cannot be tied to an
 * account the pilot agreed to, so they go: the instance polling one gets a 404, forgets it, and
 * the hub offers "Show answers on ..." again at the next visit. Tickets, identities and notes stay.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('support_handles').execute();
  await db.schema
    .createTable('support_handles')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('token_hash', col.text, (c) => c.notNull().unique())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('origin', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_used_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('support_handles_account_id')
    .on('support_handles')
    .column('account_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('support_handles').execute();
  await db.schema
    .createTable('support_handles')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('token_hash', col.text, (c) => c.notNull().unique())
    .addColumn('distinct_id', col.text, (c) => c.notNull())
    .addColumn('origin', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_used_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('support_handles_distinct_id')
    .on('support_handles')
    .column('distinct_id')
    .execute();
}
