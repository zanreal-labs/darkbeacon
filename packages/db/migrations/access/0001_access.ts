import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('access_rule')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('subject_kind', col.text, (c) => c.notNull())
    .addColumn('subject_id', col.text, (c) => c.notNull())
    .addColumn('guild_id', col.text)
    .addColumn('role', col.text, (c) => c.notNull())
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('created_by', col.text, (c) => c.notNull())
    // Discord role ids are global snowflakes, so the guild is not part of the subject key.
    .addUniqueConstraint('access_rule_subject', ['map_id', 'subject_kind', 'subject_id'])
    .execute();
  await db.schema
    .createIndex('access_rule_lookup')
    .on('access_rule')
    .columns(['subject_kind', 'subject_id'])
    .execute();

  await db.schema
    .createTable('instance_setting')
    .addColumn('key', col.text, (c) => c.primaryKey())
    .addColumn('value', col.json, (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('instance_setting').execute();
  await db.schema.dropTable('access_rule').execute();
}
