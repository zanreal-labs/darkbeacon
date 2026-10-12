import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** The instance's optional Discord bot: one row, the token sealed like other secrets. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('discord_bot')
    .addColumn('id', col.text, (c) => c.primaryKey())
    .addColumn('token', col.text, (c) => c.notNull())
    .addColumn('user_id', col.text, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('avatar_url', col.text)
    .addColumn('error', col.text)
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
}
