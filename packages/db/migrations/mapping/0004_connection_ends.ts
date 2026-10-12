import type { Kysely } from 'kysely';

/**
 * The connections of one system (`source = ? or target = ?`) were found by reading every
 * connection of the map; on a 1,000-connection chain that is every hide, restore and auto-mapped
 * jump. With an index per end both databases answer it from two index lookups.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('map_connections_source')
    .on('map_connections')
    .columns(['map_id', 'source'])
    .execute();
  await db.schema
    .createIndex('map_connections_target')
    .on('map_connections')
    .columns(['map_id', 'target'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('map_connections_target').execute();
  await db.schema.dropIndex('map_connections_source').execute();
}
