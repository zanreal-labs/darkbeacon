import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Maps can be deleted softly: `deleted_at` is set and nobody can open the map, until an instance
 * admin restores or purges it. (The description is `0008_map_description`.)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('maps').addColumn('deleted_at', col.timestamp).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('maps').dropColumn('deleted_at').execute();
}
