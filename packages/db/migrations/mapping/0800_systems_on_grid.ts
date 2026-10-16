import { sql, type Kysely } from 'kysely';

/**
 * Puts every system on the map's 24 px snap grid (the background's dots), so systems placed before
 * snapping matched the dots, or imported off it, line up with ones dragged since. Locked systems
 * too: this only rounds, at most 12 px. Numbered after `0700_map_views`, because Kysely refuses
 * migrations that sort before ones already run.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`update map_systems set x = round(x / 24.0) * 24, y = round(y / 24.0) * 24`.execute(db);
}

export async function down(): Promise<void> {
  // Rounding cannot be undone; the positions stay on the grid.
}
