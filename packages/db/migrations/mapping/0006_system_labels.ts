import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Labels, as in Wanderer: every map keeps a list of short text markers (`system_labels`, JSON
 * `[{ id, name, description }]`, WH1 to WH3 to start with), and a system has any number of them
 * on (`system_label_ids`) plus one free-text custom label. The map's coloured markers in `labels`
 * are what users call Tags; the free-text `tag` of a system stays for compatibility only.
 */
const DEFAULT_SYSTEM_LABELS = JSON.stringify([
  { id: 'wh1', name: 'WH1', description: '' },
  { id: 'wh2', name: 'WH2', description: '' },
  { id: 'wh3', name: 'WH3', description: '' },
]);

export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  await db.schema
    .alterTable('maps')
    .addColumn('system_labels', col.json, (c) => c.notNull().defaultTo(DEFAULT_SYSTEM_LABELS))
    .execute();
  await db.schema
    .alterTable('map_systems')
    .addColumn('system_label_ids', col.json, (c) => c.notNull().defaultTo('[]'))
    .execute();
  await db.schema.alterTable('map_systems').addColumn('custom_label', col.text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_systems').dropColumn('custom_label').execute();
  await db.schema.alterTable('map_systems').dropColumn('system_label_ids').execute();
  await db.schema.alterTable('maps').dropColumn('system_labels').execute();
}
