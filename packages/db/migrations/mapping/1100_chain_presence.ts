import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * When each system was last in a map's chain from home: one row per map and system the chain ever
 * held, `left_at` null while it still holds it. Filled from each map's history by the server at
 * startup, then kept as the chain changes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_chain_presence')
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('joined_at', col.timestamp, (c) => c.notNull())
    .addColumn('left_at', col.timestamp)
    .addPrimaryKeyConstraint('map_chain_presence_pk', ['map_id', 'solar_system_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_chain_presence').execute();
}
