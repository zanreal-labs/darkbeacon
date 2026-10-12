import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('public_link')
    .addColumn('map_id', col.id, (c) => c.primaryKey())
    .addColumn('enabled', col.boolean, (c) => c.notNull())
    // The unguessable part of the public link (it is the capability; shown to map admins).
    .addColumn('token', col.text, (c) => c.unique())
    .addColumn('slug', col.text, (c) => c.unique())
    .addColumn('scopes', col.json, (c) => c.notNull())
    .addColumn('noindex', col.boolean, (c) => c.notNull())
    .addColumn('mcp_mode', col.text, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp)
    .addColumn('updated_by', col.id)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('public_link').execute();
}
