import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { col } from '../../src/portable.js';

/**
 * Passages logged by hand next to tracked jumps: no character and no jump event for those, how
 * the mass counted (`cold`, `hot`, `custom`), a Higgs Anchor or a mass entangler, a note and who
 * logged it. SQLite cannot drop NOT NULL, so the table is built again with the rows copied over.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_connection_passages_next')
    .addColumn('id', col.id, (c) => c.primaryKey())
    .addColumn('map_id', col.id, (c) => c.notNull().references('maps.id').onDelete('cascade'))
    .addColumn('connection_id', col.id, (c) =>
      c.notNull().references('map_connections.id').onDelete('cascade'),
    )
    // Null for passages logged by hand.
    .addColumn('character_id', col.eveId)
    .addColumn('ship_type_id', col.eveId)
    .addColumn('mass', col.real)
    .addColumn('from_system', col.eveId, (c) => c.notNull())
    .addColumn('to_system', col.eveId, (c) => c.notNull())
    .addColumn('occurred_at', col.timestamp, (c) => c.notNull())
    // The `character.jumped` event a tracked passage was recorded from (a jump counts once).
    .addColumn('event_id', col.id, (c) => c.unique())
    // `tracked` or `manual`.
    .addColumn('source', col.text, (c) => c.notNull().defaultTo('tracked'))
    // `cold`, `hot` or `custom`.
    .addColumn('mass_mode', col.text, (c) => c.notNull().defaultTo('cold'))
    .addColumn('higgs', col.boolean, (c) => c.notNull().defaultTo(0))
    .addColumn('entangler', col.boolean, (c) => c.notNull().defaultTo(0))
    .addColumn('note', col.text)
    // The account that logged it by hand.
    .addColumn('created_by', col.id)
    .execute();
  await sql`
    INSERT INTO map_connection_passages_next
      (id, map_id, connection_id, character_id, ship_type_id, mass, from_system, to_system,
       occurred_at, event_id, source, mass_mode, higgs, entangler, note, created_by)
    SELECT id, map_id, connection_id, character_id, ship_type_id, mass, from_system, to_system,
       occurred_at, event_id, 'tracked', 'cold', 0, 0, NULL, NULL
    FROM map_connection_passages
  `.execute(db);
  await db.schema.dropTable('map_connection_passages').execute();
  await db.schema.alterTable('map_connection_passages_next').renameTo('map_connection_passages').execute();
  await db.schema
    .createIndex('map_connection_passages_connection')
    .on('map_connection_passages')
    .columns(['map_id', 'connection_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Passages logged by hand have no character or jump event: they cannot go back.
  await sql`DELETE FROM map_connection_passages WHERE source = 'manual'`.execute(db);
  for (const column of ['created_by', 'note', 'entangler', 'higgs', 'mass_mode', 'source'])
    await db.schema.alterTable('map_connection_passages').dropColumn(column).execute();
}
