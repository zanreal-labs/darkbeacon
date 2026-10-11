import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('maps')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('slug', col.text, (c) => c.notNull().unique())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('owner_account_id', col.id, (c) => c.notNull())
    .addColumn('settings', col.json, (c) => c.notNull())
    .addColumn('labels', col.json, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema.createIndex('maps_owner').on('maps').column('owner_account_id').execute();

  await db.schema
    .createTable('map_systems')
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('x', col.real, (c) => c.notNull())
    .addColumn('y', col.real, (c) => c.notNull())
    .addColumn('custom_name', col.text)
    .addColumn('temporary_name', col.text)
    .addColumn('tag', col.text)
    .addColumn('status', col.text, (c) => c.notNull())
    .addColumn('description', col.text, (c) => c.notNull())
    .addColumn('label_ids', col.json, (c) => c.notNull())
    .addColumn('locked', col.boolean, (c) => c.notNull())
    .addColumn('visible', col.boolean, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('map_systems_pk', ['map_id', 'solar_system_id'])
    .execute();

  await db.schema
    .createTable('map_connections')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('source', col.eveId, (c) => c.notNull())
    .addColumn('target', col.eveId, (c) => c.notNull())
    .addColumn('type', col.text, (c) => c.notNull())
    .addColumn('time_status', col.text, (c) => c.notNull())
    .addColumn('mass_status', col.text, (c) => c.notNull())
    .addColumn('ship_size', col.text, (c) => c.notNull())
    .addColumn('mass_saved', col.boolean, (c) => c.notNull())
    .addColumn('dangerous', col.boolean, (c) => c.notNull())
    .addColumn('bubbled', col.text, (c) => c.notNull())
    .addColumn('eol_at', col.timestamp)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema.createIndex('map_connections_map').on('map_connections').column('map_id').execute();

  await db.schema
    .createTable('map_signatures')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('eve_id', col.text, (c) => c.notNull())
    .addColumn('sig_group', col.text, (c) => c.notNull())
    .addColumn('type', col.text)
    .addColumn('name', col.text)
    .addColumn('description', col.text, (c) => c.notNull())
    .addColumn('connection_id', col.id)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addUniqueConstraint('map_signatures_eve_id', ['map_id', 'solar_system_id', 'eve_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_signatures').execute();
  await db.schema.dropTable('map_connections').execute();
  await db.schema.dropTable('map_systems').execute();
  await db.schema.dropTable('maps').execute();
}
