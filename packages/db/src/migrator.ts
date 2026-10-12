import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';

// `src/migrator.ts` and `dist/src/migrator.js` both sit one level below the migrations folder.
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const EXTENSION = import.meta.url.endsWith('.ts') ? '.ts' : '.js';

/** Kysely's own table of applied migrations. */
export const MIGRATION_TABLE = 'kysely_migration';

/**
 * Loads `migrations/<module>/<NNNN>_<name>.(ts|js)` and names each `<module>/<NNNN>_<name>`.
 * Modules do not reference each other's tables, so ordering only matters within a module.
 */
export class ModuleMigrationProvider implements MigrationProvider {
  constructor(private readonly dir = MIGRATIONS_DIR) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    const modules = (await readdir(this.dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const module of modules) {
      const files = (await readdir(join(this.dir, module)))
        .filter((f) => f.endsWith(EXTENSION) && !f.endsWith('.d.ts') && !f.includes('.test.'))
        .sort();
      for (const file of files) {
        const migration = (await import(pathToFileURL(join(this.dir, module, file)).href)) as Migration;
        migrations[`${module}/${basename(file, EXTENSION)}`] = migration;
      }
    }
    return migrations;
  }
}

/** Names of every migration this code ships, sorted. */
export async function knownMigrations(provider: MigrationProvider = new ModuleMigrationProvider()) {
  return Object.keys(await provider.getMigrations()).sort();
}

export async function migrateToLatest(
  db: Kysely<unknown>,
  options: { provider?: MigrationProvider; schema?: string | undefined } = {},
) {
  const migrator = new Migrator({
    db,
    provider: options.provider ?? new ModuleMigrationProvider(),
    allowUnorderedMigrations: true,
    // Without an explicit schema Kysely may find the migration table of another schema.
    ...(options.schema ? { migrationTableSchema: options.schema } : {}),
  });
  const { error, results = [] } = await migrator.migrateToLatest();
  const failed = results.find((r) => r.status === 'Error');
  if (error || failed) {
    const name = failed ? ` (${failed.migrationName})` : '';
    throw new Error(`migration failed${name}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return results.map((r) => r.migrationName);
}

/** Migrations applied and still to run; `applied` is empty for a fresh database. */
export async function migrationStatus(
  db: Kysely<unknown>,
  options: { provider?: MigrationProvider; schema?: string | undefined } = {},
): Promise<{ applied: string[]; pending: string[] }> {
  const migrator = new Migrator({
    db,
    provider: options.provider ?? new ModuleMigrationProvider(),
    allowUnorderedMigrations: true,
    ...(options.schema ? { migrationTableSchema: options.schema } : {}),
  });
  const all = await migrator.getMigrations();
  return {
    applied: all.filter((m) => m.executedAt !== undefined).map((m) => m.name),
    pending: all.filter((m) => m.executedAt === undefined).map((m) => m.name),
  };
}
