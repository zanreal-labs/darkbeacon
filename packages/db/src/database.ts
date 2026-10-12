import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect, type Transaction } from 'kysely';
import pg from 'pg';
import type { UnitOfWork } from '@darkbeacon/core';
import { WalCheckpointer } from './checkpointer.js';
import { migrateToLatest } from './migrator.js';
import { SplitSqliteDialect } from './sqlite-split.js';

export type Dialect = 'sqlite' | 'postgres';

export interface DatabaseOptions {
  /** A `postgres://` or `postgresql://` URL selects Postgres; anything else selects SQLite. */
  url?: string | undefined;
  /** Directory of the SQLite file `app.db` (default `/data`). */
  dataDir?: string | undefined;
  /** SQLite file path or `:memory:`; overrides `dataDir`. */
  filename?: string | undefined;
  /** Postgres schema to work in (created when missing). Tests use one schema per database. */
  schema?: string | undefined;
  /** Postgres pool size (default 10). */
  poolSize?: number | undefined;
}

export interface TransactionOptions {
  /** Postgres only; SQLite transactions are always serializable. */
  isolation?: 'repeatable read' | 'serializable';
  /**
   * Only reads (snapshots). On a SQLite file it runs on a read connection of its own, so it
   * neither waits for nor holds up writers; on Postgres it is a READ ONLY transaction.
   */
  readOnly?: boolean;
}

interface Scope {
  trx: Transaction<unknown>;
  afterCommit: Array<() => void>;
}

/**
 * The database handle adapters depend on. It is also the UnitOfWork: `transaction()` binds
 * a Kysely transaction to the async context, and `db()` returns it, so repositories called
 * from a use case share the transaction without passing it around.
 *
 * Always go through `db()` in adapters: on SQLite there is a single connection, and a query
 * on the root handle while a transaction is open would wait forever.
 */
export class Database implements UnitOfWork {
  private readonly scope = new AsyncLocalStorage<Scope>();

  constructor(
    readonly kysely: Kysely<unknown>,
    readonly dialect: Dialect,
    /** Postgres schema this handle works in, when not the default. */
    readonly schema?: string,
    /** SQLite files: a read-only connection for read-only transactions. */
    private readonly snapshots?: Kysely<unknown>,
    /** Also stopped on close (the SQLite checkpointer). */
    private readonly companions: Array<{ stop(): Promise<void> }> = [],
  ) {}

  /** The open transaction inside `transaction()`, the root handle outside. */
  db<T>(): Kysely<T> {
    return (this.scope.getStore()?.trx ?? this.kysely) as unknown as Kysely<T>;
  }

  get inTransaction(): boolean {
    return this.scope.getStore() !== undefined;
  }

  /** Runs `work` in a transaction; a nested call joins the outer transaction. */
  async transaction<T>(work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    if (this.scope.getStore()) return work();
    const afterCommit: Array<() => void> = [];
    const root = options.readOnly && this.snapshots ? this.snapshots : this.kysely;
    let builder = root.transaction();
    if (options.isolation && this.dialect === 'postgres')
      builder = builder.setIsolationLevel(options.isolation);
    if (options.readOnly && this.dialect === 'postgres') builder = builder.setAccessMode('read only');
    const result = await builder.execute((trx) => this.scope.run({ trx, afterCommit }, work));
    for (const hook of afterCommit) {
      try {
        hook();
      } catch (error) {
        console.error('afterCommit hook failed', error);
      }
    }
    return result;
  }

  /** Runs `hook` once the current transaction commits (never on rollback); immediately outside one. */
  afterCommit(hook: () => void): void {
    const scope = this.scope.getStore();
    if (scope) scope.afterCommit.push(hook);
    else hook();
  }

  /** Applies pending migrations from `packages/db/migrations/<module>/`. Returns the names applied. */
  migrate(): Promise<string[]> {
    return migrateToLatest(this.kysely, { schema: this.schema });
  }

  async ping(): Promise<void> {
    await this.db<never>()
      .selectNoFrom((eb) => eb.lit(1).as('one'))
      .execute();
  }

  async close(): Promise<void> {
    for (const companion of this.companions) await companion.stop();
    await this.snapshots?.destroy();
    await this.kysely.destroy();
  }
}

export function isPostgresUrl(url: string | undefined): url is string {
  return !!url && /^postgres(ql)?:\/\//.test(url);
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export async function createDatabase(options: DatabaseOptions = {}): Promise<Database> {
  if (isPostgresUrl(options.url)) return createPostgres(options.url, options);

  const filename = options.filename ?? join(options.dataDir ?? '/data', 'app.db');
  if (filename === ':memory:') {
    // One connection: a second one would open another, empty, database.
    return new Database(
      new Kysely({ dialect: new SqliteDialect({ database: openSqlite(filename) }) }),
      'sqlite',
    );
  }
  mkdirSync(dirname(filename), { recursive: true });
  const writer = openSqlite(filename);
  // Checkpoints happen on a thread of their own (WalCheckpointer); the commit that crosses this
  // many pages (about 400 MB) still does one, should that thread ever fall behind.
  writer.pragma('wal_autocheckpoint = 100000');
  // Once checkpointed, a WAL bigger than this is cut back.
  writer.pragma('journal_size_limit = 67108864');
  // WAL lets readers work next to the writer, each seeing the last commit.
  const reader = openSqlite(filename, { readonly: true });
  const snapshots = openSqlite(filename, { readonly: true });
  const checkpointer = new WalCheckpointer(filename, 1_000, (message) =>
    console.error(`SQLite checkpoint failed: ${message}`),
  );
  return new Database(
    new Kysely({ dialect: new SplitSqliteDialect(writer, reader) }),
    'sqlite',
    undefined,
    new Kysely({ dialect: new SqliteDialect({ database: snapshots }) }),
    [checkpointer],
  );
}

function openSqlite(filename: string, options: { readonly?: boolean } = {}): SQLite.Database {
  const sqlite = new SQLite(filename, options);
  if (!options.readonly) {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  cachePreparedStatements(sqlite);
  return sqlite;
}

/**
 * Kysely prepares every query again; preparing costs about as much as running a small query.
 * Statements are kept per SQL text (the most recently used `max`) and reused. Long SQL (batch
 * inserts of many rows, one text per row count) is prepared each time: such statements are big,
 * rare per request, and would fill the cache with variants. A statement still iterating a
 * streamed query is busy, and gets a fresh one instead.
 */
export function cachePreparedStatements(sqlite: SQLite.Database, max = 500, maxLength = 2_000): void {
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
}

async function createPostgres(url: string, options: DatabaseOptions): Promise<Database> {
  const { schema } = options;
  if (schema !== undefined) {
    if (!SCHEMA_NAME.test(schema)) throw new Error(`invalid schema name ${schema}`);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(`create schema if not exists "${schema}"`);
    } finally {
      await client.end();
    }
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: options.poolSize ?? 10,
    ...(schema ? { options: `-c search_path="${schema}"` } : {}),
    // bigint (int8) columns hold epoch ms and EVE ids; all fit in a JS number.
    types: {
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        oid === pg.types.builtins.INT8
          ? (value: string) => Number(value)
          : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  });
  return new Database(new Kysely({ dialect: new PostgresDialect({ pool }) }), 'postgres', schema);
}
