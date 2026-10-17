import type { Kysely } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Who owns each Ansiblex jump bridge: the corporation ESI names as the structure's owner and that
 * corporation's alliance. Null for bridges pasted by hand, whose owner is not known.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('routing_bridges').addColumn('owner_corporation_id', col.eveId).execute();
  await db.schema.alterTable('routing_bridges').addColumn('owner_alliance_id', col.eveId).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('routing_bridges').dropColumn('owner_alliance_id').execute();
  await db.schema.alterTable('routing_bridges').dropColumn('owner_corporation_id').execute();
}
