import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Database } from '@wormwright/db';
import type { PluginMigration } from '@wormwright/plugin-sdk';
import type { PluginTables } from '../adapters/plugins/kysely-plugin-repository.js';

/**
 * Applies a plugin's pending migrations (`NNNN_name.js`, in name order), each in its own
 * transaction, and records them as `<pluginId>/<file>` in `plugin_migration`.
 * Returns the names applied.
 */
export async function runPluginMigrations(
  database: Database,
  pluginId: string,
  directory: string,
  now: () => number,
): Promise<string[]> {
  const files = (await readdir(directory)).filter((f) => /\.(m?js)$/.test(f) && !f.includes('.test.')).sort();
  const done = new Set(
    (
      await database
        .db<PluginTables>()
        .selectFrom('plugin_migration')
        .select('name')
        .where('plugin_id', '=', pluginId)
        .execute()
    ).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of files) {
    const name = `${pluginId}/${file}`;
    if (done.has(name)) continue;
    const migration = (await import(/* @vite-ignore */ pathToFileURL(join(directory, file)).href)) as
      Partial<PluginMigration> | undefined;
    if (typeof migration?.up !== 'function') throw new Error(`${name} does not export up()`);
    await database.transaction(async () => {
      await migration.up!(database.db());
      await database
        .db<PluginTables>()
        .insertInto('plugin_migration')
        .values({ plugin_id: pluginId, name, executed_at: now() })
        .execute();
    });
    applied.push(name);
  }
  return applied;
}
