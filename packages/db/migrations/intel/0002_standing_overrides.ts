import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Standings a person set by hand (the system menu's "Holder standing"); they win over contacts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('intel_standing_overrides')
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('entity_id', col.eveId, (c) => c.notNull())
    .addColumn('standing', col.real, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('intel_standing_overrides_pk', ['account_id', 'entity_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('intel_standing_overrides').execute();
}
