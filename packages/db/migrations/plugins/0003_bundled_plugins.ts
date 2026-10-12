import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Plugins shipped on by default that this instance has seen, so an uninstalled one stays away. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugin_bundled')
    .addColumn('id', col.text, (c) => c.primaryKey())
    .addColumn('seen_at', col.timestamp, (c) => c.notNull())
    .execute();
}
