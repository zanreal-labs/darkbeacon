import type { Kysely } from 'kysely';

/**
 * Before `system` existed, the light theme (id `default`) was what everyone got and what an
 * untouched picker saved. Those saved choices now pin people to light even when their computer is
 * dark, so they are dropped: the account and the instance fall back to `system`. A light theme
 * picked from now on is stored again and kept.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await (db as Kysely<{ theme_choice: { scope: string; theme_id: string } }>)
    .deleteFrom('theme_choice')
    .where('theme_id', '=', 'default')
    .execute();
}

export async function down(): Promise<void> {
  // The removed choices only repeated the old default; nothing to restore.
}
