import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Shares between maps and the merged views built from them. Maps are named by origin (instance +
 * map id) without foreign keys into mapping: shares may one day name maps on other instances, and
 * the sharing module removes a map's rows itself when the map is deleted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_shares')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('source_instance', col.text, (c) => c.notNull())
    .addColumn('source_map_id', col.id, (c) => c.notNull())
    .addColumn('target_instance', col.text, (c) => c.notNull())
    .addColumn('target_map_id', col.id, (c) => c.notNull())
    .addColumn('level', col.text, (c) => c.notNull())
    .addColumn('offered_scopes', col.json, (c) => c.notNull())
    /** JSON list, null: everything offered. */
    .addColumn('target_scopes', col.json)
    .addColumn('status', col.text, (c) => c.notNull())
    .addColumn('hidden', col.boolean, (c) => c.notNull().defaultTo(0))
    .addColumn('offered_by', col.id, (c) => c.notNull())
    .addColumn('accepted_by', col.id)
    .addColumn('offered_at', col.timestamp, (c) => c.notNull())
    .addColumn('accepted_at', col.timestamp)
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addUniqueConstraint('map_shares_pair', [
      'source_instance',
      'source_map_id',
      'target_instance',
      'target_map_id',
    ])
    .execute();
  await db.schema
    .createIndex('map_shares_target')
    .on('map_shares')
    .columns(['target_instance', 'target_map_id'])
    .execute();

  // What a merged map's viewers were given: one row per entity (its DTO), plus its sources.
  await db.schema
    .createTable('chain_views')
    .addColumn('map_id', col.id, (c) => c.primaryKey())
    .addColumn('sources', col.json, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('chain_view_entities')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('id', col.text, (c) => c.notNull())
    .addColumn('data', col.json, (c) => c.notNull())
    .addPrimaryKeyConstraint('chain_view_entities_pk', ['map_id', 'kind', 'id'])
    .execute();

  // A merged map's own positions of systems.
  await db.schema
    .createTable('chain_layout')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('x', col.real, (c) => c.notNull())
    .addColumn('y', col.real, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('chain_layout_pk', ['map_id', 'solar_system_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('chain_layout').execute();
  await db.schema.dropTable('chain_view_entities').execute();
  await db.schema.dropTable('chain_views').execute();
  await db.schema.dropTable('map_shares').execute();
}
