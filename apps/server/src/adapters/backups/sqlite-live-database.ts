import { existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LiveDatabase, LocalFile } from '@darkbeacon/backups';
import { REQUIRED_TABLES } from '@darkbeacon/backups';
import { knownMigrations, type Database } from '@darkbeacon/db';
import { scratchFile } from './files.js';

/**
 * The running SQLite database. Snapshots use SQLite's online backup API on the server's own
 * connection while it is held (`Database.exclusive`): no transaction is open, so the copy is
 * the database between two transactions, and other queries just wait for the copy to finish.
 */
export class SqliteLiveDatabase implements LiveDatabase {
  readonly dialect: 'sqlite' | 'postgres';
  readonly supported: boolean;

  constructor(
    private readonly database: Database,
    /** Where snapshots are written before they are packed. */
    private readonly scratchDir: string,
    /** Copy in one step: set where another process (the server) may write meanwhile. */
    private readonly oneStep = false,
  ) {
    this.dialect = database.dialect;
    this.supported = database.dialect === 'sqlite' && !!database.sqlite && !database.sqlite.inMemory;
  }

  async snapshot(): Promise<LocalFile> {
    const file = scratchFile(this.scratchDir, 'snapshot', '.db');
    try {
      await this.database.exclusive((sqlite) => sqlite.backupTo(file.path, { oneStep: this.oneStep }));
      return file;
    } catch (error) {
      await file.dispose();
      throw error;
    }
  }

  knownMigrations(): Promise<string[]> {
    return knownMigrations();
  }

  replace(file: LocalFile): Promise<string[]> {
    return this.database.exclusive(async (sqlite) => {
      if (dirname(file.path) !== dirname(sqlite.filename)) {
        throw new Error('the new database must be staged next to the current one');
      }
      const rollback = `${sqlite.filename}.rollback`;
      sqlite.close();
      try {
        sqlite.swapIn(file.path, rollback);
        sqlite.open();
        const applied = await sqlite.migrate();
        const check = (sqlite.raw.pragma('quick_check') as Array<Record<string, string>>).map(
          (row) => Object.values(row)[0],
        );
        if (check.length !== 1 || check[0] !== 'ok') throw new Error(`integrity check: ${check.join('; ')}`);
        const tables = new Set(
          (
            sqlite.raw.prepare(`select name from sqlite_master where type = 'table'`).all() as Array<{
              name: string;
            }>
          ).map((t) => t.name),
        );
        const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
        if (missing.length > 0) throw new Error(`missing tables after restore: ${missing.join(', ')}`);
        rmSync(rollback, { force: true });
        return applied;
      } catch (error) {
        // Back to the database as it was; it is reopened even when putting it back fails.
        try {
          sqlite.close();
        } catch {
          // The new file may not even have opened.
        }
        if (existsSync(rollback)) sqlite.swapBack(rollback);
        sqlite.open();
        throw error;
      }
    });
  }
}
