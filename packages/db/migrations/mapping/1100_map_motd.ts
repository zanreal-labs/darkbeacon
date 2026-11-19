import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Maps gain a message of the day: Markdown everyone on the map sees when they open it. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('maps')
    .addColumn('motd', col.text, (c) => c.notNull().defaultTo(''))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('maps').dropColumn('motd').execute();
}
