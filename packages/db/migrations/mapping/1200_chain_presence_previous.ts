import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * When a system left the chain the time before it last joined, so a system in the chain now can
 * still say when it was there before. Rejoining used to overwrite that moment, so the record is
 * emptied: at startup the server plays each map's history back again (maps whose log is whole)
 * or starts recording afresh.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_chain_presence').addColumn('previous_left_at', col.timestamp).execute();
  await (db as Kysely<{ map_chain_presence: { map_id: string } }>).deleteFrom('map_chain_presence').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_chain_presence').dropColumn('previous_left_at').execute();
}
