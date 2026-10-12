import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Accounts can be disabled by instance admins (they cannot sign in or use anything), and sign-up
 * can be limited to invite links: only a hash of each invite's token is kept.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('account').addColumn('disabled_at', col.timestamp).execute();
  await db.schema.alterTable('account').addColumn('disabled_reason', col.text).execute();

  await db.schema
    .createTable('invite')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('token_hash', col.text, (c) => c.notNull().unique())
    .addColumn('note', col.text)
    .addColumn('created_by', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp)
    .addColumn('max_uses', col.integer)
    .addColumn('uses', col.integer, (c) => c.notNull().defaultTo(0))
    .addColumn('revoked_at', col.timestamp)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('invite').execute();
  await db.schema.alterTable('account').dropColumn('disabled_reason').execute();
  await db.schema.alterTable('account').dropColumn('disabled_at').execute();
}
