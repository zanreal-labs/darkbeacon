import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugin')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('manifest', col.json, (c) => c.notNull())
    .addColumn('enabled', col.boolean, (c) => c.notNull())
    .addColumn('disabled_map_ids', col.json, (c) => c.notNull())
    .addColumn('failure_count', col.integer, (c) => c.notNull())
    .addColumn('error', col.text)
    .addColumn('settings', col.json, (c) => c.notNull())
    .addColumn('map_settings', col.json, (c) => c.notNull())
    .addColumn('installed_at', col.timestamp, (c) => c.notNull())
    .execute();

  // Migrations plugins bring along, named `<pluginId>/<file>`.
  await db.schema
    .createTable('plugin_migration')
    .addColumn('plugin_id', col.text, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('executed_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('plugin_migration_pk', ['plugin_id', 'name'])
    .execute();

  await db.schema
    .createTable('theme')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('version', col.text, (c) => c.notNull())
    .addColumn('color_scheme', col.text, (c) => c.notNull())
    .addColumn('extends', col.text, (c) => c.notNull())
    .addColumn('tokens', col.json, (c) => c.notNull())
    .addColumn('installed_at', col.timestamp, (c) => c.notNull())
    .execute();

  // scope: `instance` (the default) or `account:<id>`.
  await db.schema
    .createTable('theme_choice')
    .addColumn('scope', col.text, (c) => c.primaryKey())
    .addColumn('theme_id', col.text, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('theme_choice').execute();
  await db.schema.dropTable('theme').execute();
  await db.schema.dropTable('plugin_migration').execute();
  await db.schema.dropTable('plugin').execute();
}
