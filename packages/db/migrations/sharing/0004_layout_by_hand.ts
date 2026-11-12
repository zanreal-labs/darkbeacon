import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * A merged map's layout remembers which systems someone put where they are (dragged them): the
 * map moves systems that strayed from the one they hang off back beside it, never those.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('chain_layout')
    .addColumn('by_hand', col.boolean, (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('chain_layout').dropColumn('by_hand').execute();
}
