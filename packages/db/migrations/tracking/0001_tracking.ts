import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Which characters are tracked on which map; map ids are not foreign keys (mapping owns maps).
  await db.schema
    .createTable('tracked_character')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('character_id', col.eveId, (c) => c.notNull())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('since', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('tracked_character_pk', ['map_id', 'character_id'])
    .execute();
  await db.schema
    .createIndex('tracked_character_character')
    .on('tracked_character')
    .column('character_id')
    .execute();

  // Last known state of a character, shared by every map that tracks it.
  await db.schema
    .createTable('character_presence')
    .addColumn('character_id', col.eveId, (c) => c.primaryKey())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('name', col.text, (c) => c.notNull())
    .addColumn('solar_system_id', col.eveId)
    .addColumn('ship_type_id', col.eveId)
    .addColumn('ship_name', col.text)
    .addColumn('online', col.boolean, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('character_presence').execute();
  await db.schema.dropTable('tracked_character').execute();
}
