import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * System intel, shared by every map: sovereignty claims, ESI's hourly figures (a day of them),
 * killmails of systems on maps (a week, trimmed to what the map shows), since when each system's
 * killmails are complete, names from ESI, and small state (the feed's position).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('intel_claims')
    .addColumn('system_id', col.eveId, (c) => c.primaryKey())
    .addColumn('alliance_id', col.eveId)
    .addColumn('corporation_id', col.eveId)
    .addColumn('faction_id', col.eveId)
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('intel_activity')
    .addColumn('system_id', col.eveId, (c) => c.notNull())
    .addColumn('hour', col.timestamp, (c) => c.notNull())
    .addColumn('ship_kills', col.integer)
    .addColumn('pod_kills', col.integer)
    .addColumn('npc_kills', col.integer)
    .addColumn('jumps', col.integer)
    .addPrimaryKeyConstraint('intel_activity_pk', ['system_id', 'hour'])
    .execute();
  await db.schema.createIndex('intel_activity_hour').on('intel_activity').column('hour').execute();

  await db.schema
    .createTable('intel_hours')
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('hour', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('intel_hours_pk', ['kind', 'hour'])
    .execute();

  await db.schema
    .createTable('intel_kills')
    .addColumn('id', col.eveId, (c) => c.primaryKey())
    .addColumn('hash', col.text, (c) => c.notNull())
    .addColumn('system_id', col.eveId, (c) => c.notNull())
    .addColumn('time', col.timestamp, (c) => c.notNull())
    .addColumn('value', col.real)
    .addColumn('npc', col.boolean, (c) => c.notNull())
    .addColumn('solo', col.boolean, (c) => c.notNull())
    .addColumn('victim', col.json, (c) => c.notNull())
    .addColumn('final_blow', col.json)
    .addColumn('attacker_count', col.integer, (c) => c.notNull())
    .addColumn('attackers', col.json, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('intel_kills_system_time')
    .on('intel_kills')
    .columns(['system_id', 'time'])
    .execute();
  await db.schema.createIndex('intel_kills_time').on('intel_kills').column('time').execute();

  await db.schema
    .createTable('intel_coverage')
    .addColumn('system_id', col.eveId, (c) => c.primaryKey())
    .addColumn('since', col.timestamp, (c) => c.notNull())
    .addColumn('at', col.timestamp, (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('intel_names')
    .addColumn('id', col.eveId, (c) => c.primaryKey())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('category', col.text, (c) => c.notNull())
    // ticker_known 0: not asked yet; 1 with a null ticker: ESI has none for it.
    .addColumn('ticker', col.text)
    .addColumn('ticker_known', col.boolean, (c) => c.notNull().defaultTo(0))
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('intel_state')
    .addColumn('key', col.text, (c) => c.primaryKey())
    .addColumn('value', col.json, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'intel_state',
    'intel_names',
    'intel_coverage',
    'intel_kills',
    'intel_hours',
    'intel_activity',
    'intel_claims',
  ]) {
    await db.schema.dropTable(table).execute();
  }
}
