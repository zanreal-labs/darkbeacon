import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * The public Upwell structures of New Eden, shared by every account: what ESI's
 * `GET /universe/structures/{id}` says of each structure `GET /universe/structures` lists, when
 * those details were read (`read_at`, read again after a week) and when the list last named it
 * (`listed_at`, the daily refresh). Structures the viewer's characters may use are never stored.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('routing_public_structures')
    .addColumn('structure_id', col.eveId, (c) => c.primaryKey())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('type_id', col.eveId)
    .addColumn('owner_id', col.eveId)
    .addColumn('read_at', col.timestamp, (c) => c.notNull())
    .addColumn('listed_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('routing_public_structures_system')
    .on('routing_public_structures')
    .column('solar_system_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('routing_public_structures').execute();
}
