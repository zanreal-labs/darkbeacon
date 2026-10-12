import { existsSync, renameSync, rmSync } from 'node:fs';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, type SqliteDatabase } from 'kysely';
import { copyInWorker, WalCheckpointer } from './checkpointer.js';
import { MIGRATION_TABLE, migrateToLatest } from './migrator.js';

export type RawSqlite = SQLite.Database;

/** Opens a SQLite file the way the server uses it: WAL, foreign keys, a busy timeout. */
export function openSqlite(filename: string): RawSqlite {
  const sqlite = new SQLite(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return sqlite;
}

/** A read-only connection to a WAL file: it reads next to the writer and sees every commit. */
function openReader(filename: string): RawSqlite {
  const sqlite = new SQLite(filename, { readonly: true });
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return cachePreparedStatements(sqlite);
}

/**
 * Kysely prepares every query again; preparing costs about as much as running a small query.
 * Statements are kept per SQL text (the most recently used `max`) and reused. Long SQL (batch
 * inserts of many rows, one text per row count) is prepared each time: such statements are big,
 * rare per request, and would fill the cache with variants. A statement still iterating a
 * streamed query is busy, and gets a fresh one instead.
 */
export function cachePreparedStatements(sqlite: RawSqlite, max = 500, maxLength = 2_000): RawSqlite {
  const cache = new Map<string, SQLite.Statement>();
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((source: string) => {
    if (source.length > maxLength) return prepare(source);
    const cached = cache.get(source);
    if (cached && !cached.busy) {
      // Most recently used last, so the oldest goes first.
      cache.delete(source);
      cache.set(source, cached);
      return cached;
    }
    const statement = prepare(source);
    if (!cached) {
      cache.set(source, statement);
      if (cache.size > max) cache.delete(cache.keys().next().value!);
    }
    return statement;
  }) as typeof sqlite.prepare;
  return sqlite;
}

export interface SqliteFileOptions {
  /**
   * Also open two read-only connections (`reader`, `snapshotReader`) and checkpoint the WAL on a
   * worker thread. Files only: a second connection to `:memory:` would be another database.
   */
  readers?: boolean;
}

/** Copies per step of an online backup: 4 MB with 4 KB pages. */
const BACKUP_STEP_PAGES = 1024;

/**
 * The SQLite file behind a `Database`. Kysely talks to `forKysely`, which forwards to whatever
 * handle is open, so the file can be swapped (a restore) without rebuilding anything that holds
 * the `Database`. Use it inside `Database.exclusive()`, which keeps every other query waiting.
 */
export class SqliteFile {
  #raw: RawSqlite | null;
  #readers: [RawSqlite, RawSqlite] | null = null;
  readonly #checkpointer: WalCheckpointer | null = null;

  /** What the Kysely dialect is given: statements go to the current handle. */
  readonly forKysely: SqliteDatabase = {
    prepare: (sql: string) => this.raw.prepare(sql),
    close: () => this.close(),
  };

  constructor(
    readonly filename: string,
    raw: RawSqlite,
    private readonly options: SqliteFileOptions = {},
  ) {
    this.#raw = cachePreparedStatements(raw);
    if (options.readers && !this.inMemory) {
      this.tuneWriter(raw);
      this.#readers = [openReader(filename), openReader(filename)];
      this.#checkpointer = new WalCheckpointer(filename, 1_000, (message) =>
        console.error(`SQLite checkpoint failed: ${message}`),
      );
    }
  }

  /** The read-only connection selects outside transactions go to (the write one without readers). */
  get reader(): RawSqlite {
    if (!this.options.readers || this.inMemory) return this.raw;
    if (!this.#readers) throw new Error('The database is closed (a restore is switching files)');
    return this.#readers[0];
  }

  /** The read-only connection of read-only transactions (snapshots). */
  get snapshotReader(): RawSqlite {
    if (!this.options.readers || this.inMemory) return this.raw;
    if (!this.#readers) throw new Error('The database is closed (a restore is switching files)');
    return this.#readers[1];
  }

  /** Whether reads have connections of their own. */
  get hasReaders(): boolean {
    return this.#checkpointer !== null;
  }

  /**
   * Checkpoints happen on the worker thread; the commit that crosses this many pages (about
   * 400 MB) still does one, should that thread ever fall behind. Once checkpointed, a WAL bigger
   * than 64 MB is cut back.
   */
  private tuneWriter(raw: RawSqlite): void {
    raw.pragma('wal_autocheckpoint = 100000');
    raw.pragma('journal_size_limit = 67108864');
  }

  /** Closes every connection and stops the checkpointer for good (shutdown). */
  async dispose(): Promise<void> {
    this.close();
    await this.#checkpointer?.stop();
  }

  get isOpen(): boolean {
    return this.#raw !== null;
  }

  get raw(): RawSqlite {
    if (!this.#raw) throw new Error('The database is closed (a restore is switching files)');
    return this.#raw;
  }

  /** In-memory databases have no file to back up or replace. */
  get inMemory(): boolean {
    return this.filename === ':memory:' || this.filename === '';
  }

  open(): void {
    if (this.#raw) return;
    this.#raw = cachePreparedStatements(openSqlite(this.filename));
    if (this.#checkpointer) {
      this.tuneWriter(this.#raw);
      this.#readers = [openReader(this.filename), openReader(this.filename)];
      this.#checkpointer.resume();
    }
  }

  /** Writes the WAL back into the main file and closes the handles. */
  close(): void {
    // No connection may stay on the file while it is swapped: the readers and the checkpointer first.
    this.#checkpointer?.pause();
    for (const reader of this.#readers ?? []) reader.close();
    this.#readers = null;
    if (!this.#raw) return;
    try {
      this.#raw.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Closing still checkpoints what it can.
    }
    this.#raw.close();
    this.#raw = null;
  }

  /**
   * A consistent copy of the database file into `destination` (a new file), made on a worker
   * thread through a read-only connection (`VACUUM INTO`), so reads and writes go on meanwhile.
   */
  async copyTo(destination: string): Promise<void> {
    if (this.inMemory) return this.backupTo(destination);
    await copyInWorker(this.filename, destination);
    selfContained(destination);
  }

  /**
   * Online backup of the open handle into `destination` (a new file). Call it inside
   * `Database.exclusive()`: no transaction is then open on the connection, so the copy is the
   * database exactly between two transactions. Steps yield to the event loop.
   */
  async backupTo(destination: string, options: { oneStep?: boolean } = {}): Promise<void> {
    // One step when another process writes too (the CLI): a change between steps restarts the copy.
    const pages = options.oneStep ? 0x7fffffff : BACKUP_STEP_PAGES;
    await this.raw.backup(destination, { progress: () => pages });
    selfContained(destination);
  }

  /**
   * Replaces the file with `staged` (same directory, so the rename is atomic). The current file is
   * kept at `rollback`; stale `-wal`/`-shm` files are removed. The handle must be closed.
   */
  swapIn(staged: string, rollback: string): void {
    if (this.#raw) throw new Error('close the database before swapping files');
    if (existsSync(rollback)) rmSync(rollback);
    renameSync(this.filename, rollback);
    removeSidecars(this.filename);
    renameSync(staged, this.filename);
  }

  /** Puts the file kept by `swapIn` back. The handle must be closed. */
  swapBack(rollback: string): void {
    if (this.#raw) throw new Error('close the database before swapping files');
    if (existsSync(this.filename)) rmSync(this.filename);
    removeSidecars(this.filename);
    renameSync(rollback, this.filename);
  }

  /** Runs the migrations on the open handle without going through the main Kysely instance. */
  migrate(): Promise<string[]> {
    return withKysely(this.raw, (kysely) => migrateToLatest(kysely));
  }
}

/**
 * Switches a copied file out of WAL mode, so it is one self-contained file that can be read
 * without leaving `-wal`/`-shm` files next to it. Files that cannot be opened are left alone.
 */
export function selfContained(filename: string): void {
  try {
    const sqlite = new SQLite(filename, { fileMustExist: true });
    try {
      sqlite.pragma('journal_mode = DELETE');
    } finally {
      sqlite.close();
    }
  } catch {
    // Not a database (or a damaged one): inspection says so.
  }
  removeSidecars(filename);
}

export function removeSidecars(filename: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) rmSync(`${filename}${suffix}`, { force: true });
}

/** A throwaway Kysely over a raw handle; destroying it leaves the handle open. */
async function withKysely<T>(raw: RawSqlite, work: (kysely: Kysely<unknown>) => Promise<T>): Promise<T> {
  const kysely = new Kysely<unknown>({
    dialect: new SqliteDialect({ database: { prepare: (sql) => raw.prepare(sql), close: () => undefined } }),
  });
  try {
    return await work(kysely);
  } finally {
    await kysely.destroy();
  }
}

/** What a SQLite file holds, read without changing it. */
export interface SqliteInspection {
  /** `PRAGMA integrity_check` rows: `['ok']` for a healthy file. */
  integrity: string[];
  tables: string[];
  /** Applied migrations (`<module>/<NNNN>_<name>`), empty when there is no migration table. */
  migrations: string[];
}

/** Throws a readable error when `filename` is not a SQLite database at all. */
export function inspectSqliteFile(filename: string, options: { quick?: boolean } = {}): SqliteInspection {
  let sqlite: RawSqlite;
  try {
    sqlite = new SQLite(filename, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new Error(`not a SQLite database: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  try {
    const check = options.quick ? 'quick_check' : 'integrity_check';
    const integrity = (sqlite.pragma(`${check}(20)`) as Array<Record<string, string>>).map(
      (row) => Object.values(row)[0] ?? '',
    );
    const tables = (
      sqlite.prepare(`select name from sqlite_master where type = 'table'`).all() as Array<{ name: string }>
    ).map((r) => r.name);
    const migrations = tables.includes(MIGRATION_TABLE)
      ? (
          sqlite.prepare(`select name from ${MIGRATION_TABLE} order by name`).all() as Array<{
            name: string;
          }>
        ).map((r) => r.name)
      : [];
    return { integrity, tables, migrations };
  } catch (error) {
    throw new Error(
      `not a readable SQLite database: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  } finally {
    sqlite.close();
  }
}
