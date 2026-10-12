import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * What maps that merge other maps need from them: when each field of a system, connection and
 * signature last changed (`field_times`, JSON field -> epoch ms; a missing field has not changed
 * since the row was created), deletions as tombstones, and the map kind (`composite` maps have no
 * objects of their own).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('maps')
    .addColumn('kind', col.text, (c) => c.notNull().defaultTo('standard'))
    .execute();
  for (const table of ['map_systems', 'map_connections', 'map_signatures']) {
    await db.schema
      .alterTable(table)
      .addColumn('field_times', col.json, (c) => c.notNull().defaultTo('{}'))
      .execute();
  }
  await db.schema
    .createTable('map_tombstones')
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('kind', col.text, (c) => c.notNull())
    /** `<low>-<high>` for connections, `<system>:<code>` for signatures. */
    .addColumn('key', col.text, (c) => c.notNull())
    .addColumn('deleted_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('map_tombstones_pk', ['map_id', 'kind', 'key'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_tombstones').execute();
  for (const table of ['map_systems', 'map_connections', 'map_signatures']) {
    await db.schema.alterTable(table).dropColumn('field_times').execute();
  }
  await db.schema.alterTable('maps').dropColumn('kind').execute();
}
