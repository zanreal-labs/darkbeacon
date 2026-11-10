import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('jump_shares')
    // The unguessable part of the link (`/j/<token>`): it is the capability.
    .addColumn('token', col.text, (c) => c.primaryKey())
    // The plan request as shared: ship, ends, stops, skills, options.
    .addColumn('request', col.json, (c) => c.notNull())
    .addColumn('fuel_hub', col.text, (c) => c.notNull())
    .addColumn('created_by', col.id, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('jump_shares').execute();
}
