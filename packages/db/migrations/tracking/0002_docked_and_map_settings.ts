import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Whether a tracked character is docked (null until ESI said), and each account's own settings
 * on a map: the main character there and the character the map follows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('character_presence').addColumn('docked', col.boolean).execute();
  await db.schema
    .createTable('map_character_setting')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('main_character_id', col.eveId)
    .addColumn('follow_character_id', col.eveId)
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('map_character_setting_pk', ['map_id', 'account_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_character_setting').execute();
  await db.schema.alterTable('character_presence').dropColumn('docked').execute();
}
