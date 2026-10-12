import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Maps gain a description (what the map is for), shown in the list of maps. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('maps')
    .addColumn('description', col.text, (c) => c.notNull().defaultTo(''))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('maps').dropColumn('description').execute();
}
