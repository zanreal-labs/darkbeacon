import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Ansiblex jump bridges of a map (one row per pair of systems, `a` the lower id), the route
 * options each account keeps, and each map's own routing settings (the Thera toggle).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('routing_bridges')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('a', col.eveId, (c) => c.notNull())
    .addColumn('b', col.eveId, (c) => c.notNull())
    .addColumn('dangerous', col.boolean, (c) => c.notNull().defaultTo(0))
    .addColumn('source', col.text, (c) => c.notNull())
    .addColumn('structure_id', col.eveId)
    .addColumn('structure_name', col.text)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addUniqueConstraint('routing_bridges_pair', ['map_id', 'a', 'b'])
    .execute();
  await db.schema
    .createTable('routing_preferences')
    .addColumn('account_id', col.id, (c) => c.primaryKey())
    .addColumn('settings', col.json, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('routing_map_settings')
    .addColumn('map_id', col.id, (c) => c.primaryKey())
    .addColumn('settings', col.json, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('routing_map_settings').execute();
  await db.schema.dropTable('routing_preferences').execute();
  await db.schema.dropTable('routing_bridges').execute();
}
