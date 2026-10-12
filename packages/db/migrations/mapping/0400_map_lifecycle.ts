import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Maps get a description (shown on the maps page) and can be deleted softly: `deleted_at` is set
 * and nobody can open the map, until an instance admin restores or purges it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('maps')
    .addColumn('description', col.text, (c) => c.notNull().defaultTo(''))
    .execute();
  await db.schema.alterTable('maps').addColumn('deleted_at', col.timestamp).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('maps').dropColumn('deleted_at').execute();
  await db.schema.alterTable('maps').dropColumn('description').execute();
}
