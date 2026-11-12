import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  // The route the sharer looked at and, for a client's freight quote, its price and terms.
  await db.schema.alterTable('jump_shares').addColumn('options', col.json).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('jump_shares').dropColumn('options').execute();
}
