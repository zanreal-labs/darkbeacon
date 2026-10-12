import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** One account's own view of a map: last viewport and bookmark label template. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_preferences')
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('viewport', col.json)
    .addColumn('bookmark_template', col.text)
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('map_preferences_pk', ['map_id', 'account_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_preferences').execute();
}
