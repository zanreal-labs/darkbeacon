import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** The map `/` opens for an account, and the maps it opened recently (JSON array of ids). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('account').addColumn('default_map_id', col.id).execute();
  await db.schema.alterTable('account').addColumn('recent_map_ids', col.json).execute();
}
