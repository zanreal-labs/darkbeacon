import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Webhooks count the deliveries that failed in a row (every retry used up) and are turned off
 * after too many, as Wanderer does; `disabled_reason` says why until someone turns them on again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('webhook')
    .addColumn('consecutive_failures', col.integer, (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable('webhook').addColumn('disabled_reason', col.text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('webhook').dropColumn('disabled_reason').execute();
  await db.schema.alterTable('webhook').dropColumn('consecutive_failures').execute();
}
