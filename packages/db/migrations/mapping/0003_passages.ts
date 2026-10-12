import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Ships that went through a connection (from tracked characters' jumps), and when a connection's
 * mass status was last set, so mass estimates count only what passed since.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_connections').addColumn('mass_status_at', col.timestamp).execute();

  await db.schema
    .createTable('map_connection_passages')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('connection_id', col.id, (c) =>
      c.notNull().references('map_connections.id').onDelete('cascade'),
    )
    .addColumn('character_id', col.eveId, (c) => c.notNull())
    .addColumn('ship_type_id', col.eveId)
    .addColumn('mass', col.real)
    .addColumn('from_system', col.eveId, (c) => c.notNull())
    .addColumn('to_system', col.eveId, (c) => c.notNull())
    .addColumn('occurred_at', col.timestamp, (c) => c.notNull())
    // The `character.jumped` event it was recorded from: a jump counts once.
    .addColumn('event_id', col.id, (c) => c.notNull().unique())
    .execute();
  await db.schema
    .createIndex('map_connection_passages_connection')
    .on('map_connection_passages')
    .columns(['map_id', 'connection_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_connection_passages').execute();
  await db.schema.alterTable('map_connections').dropColumn('mass_status_at').execute();
}
