import { sql, type Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('account')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('discord_id', col.text, (c) => c.unique())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('avatar_url', col.text)
    .addColumn('instance_role', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_seen_at', col.timestamp)
    .execute();
  // An instance has at most one owner, even when two first logins race.
  await db.schema
    .createIndex('account_single_owner')
    .on('account')
    .column('instance_role')
    .unique()
    .where(sql.ref('instance_role'), '=', 'owner')
    .execute();
  await db.schema.createIndex('account_name').on('account').column('name').execute();

  await db.schema
    .createTable('session')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp, (c) => c.notNull())
    .addColumn('last_seen_at', col.timestamp, (c) => c.notNull())
    .addColumn('user_agent', col.text)
    .execute();
  await db.schema.createIndex('session_account').on('session').column('account_id').execute();
  await db.schema.createIndex('session_expires').on('session').column('expires_at').execute();

  await db.schema
    .createTable('discord_link')
    .addColumn('account_id', col.id, (c) => c.primaryKey())
    .addColumn('access_token', col.text, (c) => c.notNull())
    .addColumn('refresh_token', col.text, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp, (c) => c.notNull())
    .addColumn('guild_roles', col.json, (c) => c.notNull())
    .addColumn('roles_checked_at', col.timestamp)
    .execute();

  await db.schema
    .createTable('eve_character')
    .addColumn('id', col.eveId, (c) => c.primaryKey())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('corporation_id', col.eveId, (c) => c.notNull())
    .addColumn('alliance_id', col.eveId)
    .addColumn('owner_hash', col.text, (c) => c.notNull())
    .addColumn('token_valid', col.boolean, (c) => c.notNull())
    .addColumn('linked_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema.createIndex('eve_character_account').on('eve_character').column('account_id').execute();

  await db.schema
    .createTable('eve_character_token')
    .addColumn('character_id', col.eveId, (c) => c.primaryKey())
    .addColumn('access_token', col.text, (c) => c.notNull())
    .addColumn('refresh_token', col.text, (c) => c.notNull())
    .addColumn('expires_at', col.timestamp, (c) => c.notNull())
    .addColumn('scopes', col.json, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['eve_character_token', 'eve_character', 'discord_link', 'session', 'account']) {
    await db.schema.dropTable(table).execute();
  }
}
