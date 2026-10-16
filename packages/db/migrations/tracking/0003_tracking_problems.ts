import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Why tracking cannot read a character's location, while it cannot (one row per character). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('tracking_problem')
    .addColumn('character_id', col.eveId, (c) => c.primaryKey())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('message', col.text, (c) => c.notNull())
    .addColumn('since', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('tracking_problem').execute();
}
