import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Sources lay themselves out in coordinate spaces of their own: a merged map shifts each source's
 * cluster beside the others once, and keeps the shift so later systems of the source join it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('chain_source_offsets')
    .addColumn('map_id', col.id, (c) => c.notNull())
    /** `self` or a share id. */
    .addColumn('source_id', col.id, (c) => c.notNull())
    .addColumn('x', col.real, (c) => c.notNull())
    .addColumn('y', col.real, (c) => c.notNull())
    .addColumn('updated_at', col.timestamp, (c) => c.notNull())
    .addPrimaryKeyConstraint('chain_source_offsets_pk', ['map_id', 'source_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('chain_source_offsets').execute();
}
