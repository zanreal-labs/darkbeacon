import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Anonymous telemetry: the instance's random id and pseudonym secret, the admin switch and the
 * last heartbeat (`telemetry_state`, key -> value), and which admins dismissed the notice.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('telemetry_state')
    .addColumn('key', col.text, (c) => c.primaryKey())
    .addColumn('value', col.text, (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('telemetry_notice')
    .addColumn('account_id', col.id, (c) => c.primaryKey())
    .addColumn('dismissed_at', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('telemetry_notice').execute();
  await db.schema.dropTable('telemetry_state').execute();
}
