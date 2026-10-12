import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * A higher level offered on an active share waits for the target's consent (`offered_level`);
 * a composite picks the source its new objects go to (`default_write`); and a composite keeps
 * notes, label assignments and locks of systems itself (`chain_local_fields`), over the merged ones.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('map_shares').addColumn('offered_level', col.text).execute();
  await db.schema
    .alterTable('map_shares')
    .addColumn('default_write', col.boolean, (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .createTable('chain_local_fields')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    /** Null: the merged notes show. */
    .addColumn('notes', col.text)
    /** JSON list of the map's label ids. */
    .addColumn('label_ids', col.json, (c) => c.notNull().defaultTo('[]'))
    .addColumn('locked', col.boolean, (c) => c.notNull().defaultTo(0))
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('chain_local_fields_pk', ['map_id', 'solar_system_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('chain_local_fields').execute();
  await db.schema.alterTable('map_shares').dropColumn('default_write').execute();
  await db.schema.alterTable('map_shares').dropColumn('offered_level').execute();
}
