import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Connections gain a note, a lock (managers only change or remove them, auto-mapping never does)
 * and a lifetime mark ("less than 16 h left" and when it was set). Scan results gain their kind
 * (signature, anomaly or other scanner rows) and a flag for custom entries, whose ids are free text.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  await db.schema
    .alterTable('map_connections')
    .addColumn('note', col.text, (c) => c.notNull().defaultTo(''))
    .execute();
  await db.schema
    .alterTable('map_connections')
    .addColumn('locked', col.boolean, (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable('map_connections').addColumn('lifetime_mark', col.text).execute();
  await db.schema.alterTable('map_connections').addColumn('lifetime_at', col.timestamp).execute();
  await db.schema
    .alterTable('map_signatures')
    .addColumn('kind', col.text, (c) => c.notNull().defaultTo('signature'))
    .execute();
  await db.schema
    .alterTable('map_signatures')
    .addColumn('custom', col.boolean, (c) => c.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_signatures').dropColumn('custom').execute();
  await db.schema.alterTable('map_signatures').dropColumn('kind').execute();
  await db.schema.alterTable('map_connections').dropColumn('lifetime_at').execute();
  await db.schema.alterTable('map_connections').dropColumn('lifetime_mark').execute();
  await db.schema.alterTable('map_connections').dropColumn('locked').execute();
  await db.schema.alterTable('map_connections').dropColumn('note').execute();
}
