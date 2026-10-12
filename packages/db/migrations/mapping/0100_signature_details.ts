import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

const TEXT_COLUMNS = ['temp_name', 'destination', 'time_status', 'mass_status'] as const;
const JSON_COLUMNS = ['created_by', 'updated_by'] as const;

/**
 * What the signature editor knows besides group, type and name: the temporary name a wormhole
 * gives the system it leads to, where a K162 leads, the lifetime and mass the pilot saw, whether
 * it sits in a bubble, and who added and last changed it (JSON `{ accountId, characterId, name }`).
 * `updated_at` is indexed for the sweep of old signatures.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  for (const name of TEXT_COLUMNS)
    await db.schema.alterTable('map_signatures').addColumn(name, col.text).execute();
  for (const name of JSON_COLUMNS)
    await db.schema.alterTable('map_signatures').addColumn(name, col.json).execute();
  await db.schema
    .alterTable('map_signatures')
    .addColumn('bubbled', col.boolean, (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex('map_signatures_updated').on('map_signatures').column('updated_at').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('map_signatures_updated').execute();
  for (const name of [...TEXT_COLUMNS, ...JSON_COLUMNS, 'bubbled'])
    await db.schema.alterTable('map_signatures').dropColumn(name).execute();
}
