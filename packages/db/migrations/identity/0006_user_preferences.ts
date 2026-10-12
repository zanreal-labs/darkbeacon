import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Per-person options that follow the account between browsers, one JSON object per area. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_preference')
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('area', col.text, (c) => c.notNull())
    .addColumn('value', col.json, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('user_preference_pk', ['account_id', 'area'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_preference').execute();
}
