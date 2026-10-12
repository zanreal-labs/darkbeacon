import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Hubs routes measure distances to: a map's own (set by its managers) and each account's own. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('routing_map_hubs')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('position', col.integer, (c) => c.notNull())
    .addPrimaryKeyConstraint('routing_map_hubs_pk', ['map_id', 'solar_system_id'])
    .execute();
  await db.schema
    .createTable('routing_personal_hubs')
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('position', col.integer, (c) => c.notNull())
    .addPrimaryKeyConstraint('routing_personal_hubs_pk', ['account_id', 'solar_system_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('routing_personal_hubs').execute();
  await db.schema.dropTable('routing_map_hubs').execute();
}
