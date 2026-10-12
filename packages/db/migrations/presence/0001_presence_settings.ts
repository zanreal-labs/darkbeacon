import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Per-account presence choices. Presence itself (cursors, selections...) is never stored. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('presence_setting')
    .addColumn('account_id', col.id, (c) => c.primaryKey())
    .addColumn('share_cursor', col.boolean, (c) => c.notNull())
    .addColumn('show_others', col.boolean, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('presence_setting').execute();
}
