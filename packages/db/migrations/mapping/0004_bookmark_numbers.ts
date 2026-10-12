import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * `{n}` of a wormhole, kept per connection so it is the same for everyone and stays put: the
 * number and the system it counts out of. Null until the server numbers it (at startup for
 * connections from before), and for stargates and bridges. A viewer's own order goes with the
 * other preferences.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  await db.schema.alterTable('map_connections').addColumn('bookmark_number', col.integer).execute();
  await db.schema.alterTable('map_connections').addColumn('bookmark_parent', col.eveId).execute();
  await db.schema.alterTable('map_preferences').addColumn('bookmark_order', col.text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_preferences').dropColumn('bookmark_order').execute();
  await db.schema.alterTable('map_connections').dropColumn('bookmark_parent').execute();
  await db.schema.alterTable('map_connections').dropColumn('bookmark_number').execute();
}
