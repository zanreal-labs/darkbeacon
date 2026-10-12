import type { RawSqlite, SqliteFile } from './sqlite.js';
import {
  CompiledQuery,
  SelectQueryNode,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
} from 'kysely';

/** One holder at a time, in arrival order. */
class Lock {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const before = this.tail;
    this.tail = before.then(() => held);
    await before;
    return release;
  }
}

function execute(db: RawSqlite, { sql, parameters }: CompiledQuery): QueryResult<unknown> {
  const statement = db.prepare(sql);
  if (statement.reader) return { rows: statement.all(parameters as unknown[]) };
  const { changes, lastInsertRowid } = statement.run(parameters as unknown[]);
  return {
    insertId: lastInsertRowid != null ? BigInt(lastInsertRowid) : undefined,
    numAffectedRows: changes != null ? BigInt(changes) : undefined,
    rows: [],
  };
}

/**
 * What Kysely holds for one query or one transaction. Transactions and writes take the writer
 * (one at a time, as SQLite allows); a select outside a transaction goes to the reader at once,
 * so reads never queue behind a transaction that is waiting on something else.
 */
class Lease implements DatabaseConnection {
  private release: (() => void) | null = null;
  private inTransaction = false;

  constructor(private readonly driver: SplitSqliteDriver) {}

  async lock(): Promise<void> {
    this.release ??= await this.driver.writerLock.acquire();
  }

  unlock(): void {
    this.release?.();
    this.release = null;
  }

  async begin(): Promise<void> {
    await this.lock();
    execute(this.driver.file.raw, CompiledQuery.raw('begin'));
    this.inTransaction = true;
  }

  end(command: 'commit' | 'rollback'): void {
    this.inTransaction = false;
    execute(this.driver.file.raw, CompiledQuery.raw(command));
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    if (this.inTransaction) return execute(this.driver.file.raw, compiled) as QueryResult<R>;
    if (SelectQueryNode.is(compiled.query)) {
      // While someone holds the file exclusively (a backup, a restore), reads wait too.
      while (this.driver.gate) await this.driver.gate;
      return execute(this.driver.file.reader, compiled) as QueryResult<R>;
    }
    await this.lock();
    try {
      return execute(this.driver.file.raw, compiled) as QueryResult<R>;
    } finally {
      this.unlock();
    }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming queries are not supported');
  }
}

class SplitSqliteDriver implements Driver {
  readonly writerLock = new Lock();
  /** Set while `exclusive` runs. */
  gate: Promise<void> | null = null;

  constructor(readonly file: SqliteFile) {}

  /** Runs `work` with no transaction open and every query, reads included, waiting. */
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.writerLock.acquire();
    let open!: () => void;
    this.gate = new Promise<void>((resolve) => (open = resolve));
    try {
      return await work();
    } finally {
      this.gate = null;
      open();
      release();
    }
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new Lease(this);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as Lease).begin();
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    (connection as Lease).end('commit');
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    (connection as Lease).end('rollback');
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    (connection as Lease).unlock();
  }

  async destroy(): Promise<void> {
    await this.file.dispose();
  }
}

/** SQLite allows one writer; Kysely must not add its own single-connection lock on top. */
class SplitSqliteAdapter extends SqliteAdapter {
  override get supportsMultipleConnections(): boolean {
    return true;
  }
}

/**
 * SQLite in WAL mode with one write connection and one read connection: transactions and
 * writes go to the writer one at a time, selects outside transactions to the reader, which
 * always sees the last commit. better-sqlite3 runs queries synchronously, so this does not add
 * parallelism; it removes the wait of every read for whatever transaction holds the connection.
 */
export class SplitSqliteDialect implements Dialect {
  /** The driver Kysely created, for `exclusive`. */
  driver: SplitSqliteDriver | null = null;

  constructor(private readonly file: SqliteFile) {}

  createDriver(): Driver {
    this.driver = new SplitSqliteDriver(this.file);
    return this.driver;
  }

  /** Runs `work` with the file to itself (see `Database.exclusive`). */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (!this.driver) throw new Error('the database is not open');
    return this.driver.exclusive(work);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SplitSqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}
