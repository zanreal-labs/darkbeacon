import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Rally pings: one system of a map that everyone is called to, with a message, who called it and
 * with which character, until it is cancelled (Wanderer's rally points).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_pings')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('type', col.text, (c) => c.notNull())
    .addColumn('message', col.text, (c) => c.notNull())
    .addColumn('created_by', col.id, (c) => c.notNull())
    .addColumn('created_by_name', col.text)
    .addColumn('character_id', col.eveId)
    .addColumn('character_name', col.text)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema.createIndex('map_pings_map').on('map_pings').columns(['map_id']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_pings').execute();
}
