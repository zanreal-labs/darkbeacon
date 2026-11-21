import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Way-home watches: a member asks to be told when a way from a known-space system to the map's
 * Home opens within so many jumps. `state` and the columns after it are what the watch remembers
 * between looks (open or waiting, the last mouth, since when a way is missing), so a restart does
 * not ping again; `route` is the way announced while it stands. Removed with the map (routing
 * forgets them on `map.removed`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('routing_route_watches')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('target_system_id', col.eveId, (c) => c.notNull())
    .addColumn('max_jumps', col.integer, (c) => c.notNull())
    .addColumn('mode', col.text, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp, (c) => c.notNull())
    .addColumn('state', col.text, (c) => c.notNull())
    .addColumn('open_since', col.timestamp)
    .addColumn('missing_since', col.timestamp)
    .addColumn('last_notified_at', col.timestamp)
    .addColumn('last_mouth', col.eveId)
    .addColumn('closed_at', col.timestamp)
    .addColumn('route', col.json)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('routing_route_watches_map')
    .on('routing_route_watches')
    .column('map_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('routing_route_watches').execute();
}
