import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('api_key')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    // The public part of the token; finds the row.
    .addColumn('lookup', col.text, (c) => c.notNull().unique())
    // HMAC-SHA256 of the secret part with a pepper derived from SECRET_KEY; never the token.
    .addColumn('secret_hash', col.text, (c) => c.notNull())
    .addColumn('scopes', col.json, (c) => c.notNull())
    .addColumn('read_only', col.boolean, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp)
    .addColumn('allowed_ips', col.json, (c) => c.notNull())
    .addColumn('rate_limit_per_minute', col.integer)
    .addColumn('owner_account_id', col.id)
    .addColumn('created_by', col.id, (c) => c.notNull())
    .addColumn('instance_role', col.text)
    .addColumn('map_grants', col.json, (c) => c.notNull())
    .addColumn('all_maps_role', col.text)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('rotated_at', col.timestamp)
    .addColumn('last_used_at', col.timestamp)
    .addColumn('last_used_ip', col.text)
    .addColumn('revoked_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('api_key_owner')
    .on('api_key')
    .columns(['owner_account_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('api_key').execute();
}
