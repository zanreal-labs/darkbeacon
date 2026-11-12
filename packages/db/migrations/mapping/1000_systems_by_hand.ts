import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Systems remember whether someone put them where they are (dragged them): a map moves systems
 * that strayed from the one they hang off back beside it by itself, never ones put there by hand.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('map_systems')
    .addColumn('by_hand', col.boolean, (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_systems').dropColumn('by_hand').execute();
}
