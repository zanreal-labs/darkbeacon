import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('oauth_client')
    // The metadata document URL, or a generated id for dynamically registered clients.
    .addColumn('id', col.text, (c) => c.primaryKey())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('uri', col.text)
    .addColumn('redirect_uris', col.json, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('fetched_at', col.timestamp, (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('oauth_grant')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('client_id', col.text, (c) => c.notNull())
    .addColumn('client_name', col.text, (c) => c.notNull())
    .addColumn('client_uri', col.text)
    .addColumn('scopes', col.json, (c) => c.notNull())
    .addColumn('read_only', col.boolean, (c) => c.notNull())
    .addColumn('resource', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_used_at', col.timestamp)
    .addColumn('last_used_ip', col.text)
    .addColumn('revoked_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('oauth_grant_account')
    .on('oauth_grant')
    .columns(['account_id', 'created_at'])
    .execute();

  // Codes and tokens keep only an HMAC of their secret part.
  await db.schema
    .createTable('oauth_code')
    .addColumn('lookup', col.text, (c) => c.primaryKey())
    .addColumn('secret_hash', col.text, (c) => c.notNull())
    .addColumn('grant_id', col.id, (c) => c.notNull())
    .addColumn('client_id', col.text, (c) => c.notNull())
    .addColumn('redirect_uri', col.text, (c) => c.notNull())
    .addColumn('code_challenge', col.text, (c) => c.notNull())
    .addColumn('resource', col.text, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp, (c) => c.notNull())
    .addColumn('used_at', col.timestamp)
    .execute();

  await db.schema
    .createTable('oauth_token')
    .addColumn('lookup', col.text, (c) => c.primaryKey())
    .addColumn('secret_hash', col.text, (c) => c.notNull())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('grant_id', col.id, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp, (c) => c.notNull())
    .addColumn('used_at', col.timestamp)
    .execute();
  await db.schema.createIndex('oauth_token_expiry').on('oauth_token').column('expires_at').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('oauth_token').execute();
  await db.schema.dropTable('oauth_code').execute();
  await db.schema.dropTable('oauth_grant').execute();
  await db.schema.dropTable('oauth_client').execute();
}
