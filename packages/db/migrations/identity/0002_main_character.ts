import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('account').addColumn('main_character_id', col.eveId).execute();
}
