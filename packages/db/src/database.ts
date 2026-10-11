import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect, type Transaction } from 'kysely';
import pg from 'pg';
import type { UnitOfWork } from '@wormwright/core';
import { migrateToLatest } from './migrator.js';

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
    let builder = this.kysely.transaction();
    if (options.isolation && this.dialect === 'postgres')
      builder = builder.setIsolationLevel(options.isolation);
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

  close(): Promise<void> {
    return this.kysely.destroy();
  }
}

export function isPostgresUrl(url: string | undefined): url is string {
  return !!url && /^postgres(ql)?:\/\//.test(url);
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export async function createDatabase(options: DatabaseOptions = {}): Promise<Database> {
  if (isPostgresUrl(options.url)) return createPostgres(options.url, options);

  const filename = options.filename ?? join(options.dataDir ?? '/data', 'app.db');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new SQLite(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return new Database(new Kysely({ dialect: new SqliteDialect({ database: sqlite }) }), 'sqlite');
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
