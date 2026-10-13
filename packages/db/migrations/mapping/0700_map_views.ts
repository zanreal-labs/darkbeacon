import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * The map's published views (`views`, JSON `[{ id, name, slot?, view, updatedAt }]`): saved
 * layouts of the map screen every member gets. Numbered after `0600_default_tags`, because Kysely
 * refuses migrations that sort before ones already run.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('maps')
    .addColumn('views', col.json, (c) => c.notNull().defaultTo('[]'))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('maps').dropColumn('views').execute();
}
