import { sql, type Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * One connection per unordered pair of systems, enforced by the database: `pair_low` and
 * `pair_high` hold the smaller and larger system id. Duplicates that slipped in before are
 * merged into the oldest connection.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite adds one column per ALTER TABLE.
  await db.schema.alterTable('map_connections').addColumn('pair_low', col.eveId).execute();
  await db.schema.alterTable('map_connections').addColumn('pair_high', col.eveId).execute();
  await sql`update map_connections set
      pair_low = case when source < target then source else target end,
      pair_high = case when source < target then target else source end`.execute(db);
  await sql`delete from map_connections where id not in
      (select min(id) from map_connections group by map_id, pair_low, pair_high)`.execute(db);
  await sql`update map_signatures set connection_id = null
      where connection_id is not null and connection_id not in (select id from map_connections)`.execute(db);
  await db.schema
    .createIndex('map_connections_pair')
    .on('map_connections')
    .columns(['map_id', 'pair_low', 'pair_high'])
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('map_connections_pair').execute();
  await db.schema.alterTable('map_connections').dropColumn('pair_high').execute();
  await db.schema.alterTable('map_connections').dropColumn('pair_low').execute();
}
