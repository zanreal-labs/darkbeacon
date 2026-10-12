import type { Database } from '@darkbeacon/db';
import type { AppConfig } from '../config/config.js';

/**
 * Runs at startup when an existing database has pending migrations, before they run (the
 * backups module takes a backup). The database is open but not migrated yet: no Nest provider
 * exists at that point, so hooks get the config and the database only.
 */
export type BeforeMigrationHook = (context: {
  config: AppConfig;
  database: Database;
  pending: string[];
}) => Promise<void>;

const hooks: BeforeMigrationHook[] = [];

/** Registered by a feature module's file when it is imported (see `modules/index.ts`). */
export function onBeforeMigration(hook: BeforeMigrationHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

export function beforeMigrationHooks(): readonly BeforeMigrationHook[] {
  return hooks;
}
