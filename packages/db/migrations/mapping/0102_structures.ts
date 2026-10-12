import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Structures in the systems of a map, with their owner (JSON `{ id, name, ticker }`), status and
 * timer; `created_by` and `updated_by` are JSON authors.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_structures')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('type_id', col.eveId)
    .addColumn('type_name', col.text, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('owner', col.json)
    .addColumn('status', col.text, (c) => c.notNull())
    .addColumn('ends_at', col.timestamp)
    .addColumn('notes', col.text, (c) => c.notNull())
    .addColumn('created_by', col.json)
    .addColumn('updated_by', col.json)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('map_structures_system')
    .on('map_structures')
    .columns(['map_id', 'solar_system_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_structures').execute();
}
