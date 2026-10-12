import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/** Comment threads on the systems of a map; `author` is JSON `{ accountId, characterId, name }`. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_comments')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('solar_system_id', col.eveId, (c) => c.notNull())
    .addColumn('text', col.text, (c) => c.notNull())
    .addColumn('author', col.json)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('map_comments_system')
    .on('map_comments')
    .columns(['map_id', 'solar_system_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_comments').execute();
}
