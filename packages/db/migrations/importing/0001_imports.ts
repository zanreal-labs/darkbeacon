import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Imports from Wanderer: staged and running jobs (with the map they read), what each import wrote
 * per map and source (links: the stable Wanderer id, the id here, the values written and the
 * Wanderer fields with no place here), and maps that keep pulling from Wanderer.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('import_job')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('account_id', col.id, (c) => c.notNull())
    .addColumn('actor', col.json, (c) => c.notNull())
    .addColumn('status', col.text, (c) => c.notNull())
    .addColumn('source', col.json, (c) => c.notNull())
    .addColumn('mode', col.text)
    .addColumn('map_id', col.id)
    .addColumn('map_slug', col.text)
    .addColumn('map_name', col.text)
    .addColumn('phase', col.text, (c) => c.notNull())
    .addColumn('done', col.integer, (c) => c.notNull())
    .addColumn('total', col.integer, (c) => c.notNull())
    // The map as read from the source; dropped a week after the job finished.
    .addColumn('dump', col.json)
    .addColumn('counts', col.json, (c) => c.notNull())
    .addColumn('report', col.json, (c) => c.notNull())
    .addColumn('access', col.json, (c) => c.notNull())
    .addColumn('outcome', col.json, (c) => c.notNull())
    .addColumn('warnings', col.json, (c) => c.notNull())
    .addColumn('error', col.text)
    .addColumn('options', col.json)
    // AES-256-GCM sealed API source (key included), for a sync set up when the job finishes.
    .addColumn('sealed_source', col.text)
    .addColumn('sync_id', col.id)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addColumn('finished_at', col.timestamp)
    .execute();
  await db.schema
    .createIndex('import_job_status')
    .on('import_job')
    .columns(['status', 'created_at'])
    .execute();

  await db.schema
    .createTable('import_link')
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('source_key', col.text, (c) => c.notNull())
    .addColumn('kind', col.text, (c) => c.notNull())
    .addColumn('external_id', col.text, (c) => c.notNull())
    .addColumn('local_id', col.text, (c) => c.notNull())
    .addColumn('written', col.json, (c) => c.notNull())
    .addColumn('extra', col.json)
    .addColumn('imported_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('import_link_pk', ['map_id', 'source_key', 'kind', 'external_id'])
    .execute();

  await db.schema
    .createTable('import_sync')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull())
    .addColumn('actor', col.json, (c) => c.notNull())
    .addColumn('source', col.json, (c) => c.notNull())
    .addColumn('sealed_source', col.text, (c) => c.notNull())
    .addColumn('interval_minutes', col.integer, (c) => c.notNull())
    .addColumn('remove_missing', col.boolean, (c) => c.notNull())
    .addColumn('enabled', col.boolean, (c) => c.notNull())
    .addColumn('last_run_at', col.timestamp)
    .addColumn('last_job_id', col.id)
    .addColumn('last_error', col.text)
    .addColumn('failures', col.integer, (c) => c.notNull())
    .addColumn('next_run_at', col.timestamp)
    .addColumn('created_at', col.timestamp, (c) => c.notNull())
    .execute();
  await db.schema.createIndex('import_sync_map').on('import_sync').column('map_id').execute();
  await db.schema
    .createIndex('import_sync_due')
    .on('import_sync')
    .columns(['enabled', 'next_run_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('import_sync').execute();
  await db.schema.dropTable('import_link').execute();
  await db.schema.dropTable('import_job').execute();
}
