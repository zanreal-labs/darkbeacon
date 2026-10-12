import type SQLite from 'better-sqlite3';
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

function execute(db: SQLite.Database, { sql, parameters }: CompiledQuery): QueryResult<unknown> {
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
    execute(this.driver.writer, CompiledQuery.raw('begin'));
    this.inTransaction = true;
  }

  end(command: 'commit' | 'rollback'): void {
    this.inTransaction = false;
    execute(this.driver.writer, CompiledQuery.raw(command));
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    if (this.inTransaction) return execute(this.driver.writer, compiled) as QueryResult<R>;
    if (SelectQueryNode.is(compiled.query)) return execute(this.driver.reader, compiled) as QueryResult<R>;
    await this.lock();
    try {
      return execute(this.driver.writer, compiled) as QueryResult<R>;
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

  constructor(
    readonly writer: SQLite.Database,
    readonly reader: SQLite.Database,
  ) {}

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
    this.reader.close();
    this.writer.close();
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
  constructor(
    private readonly writer: SQLite.Database,
    private readonly reader: SQLite.Database,
  ) {}

  createDriver(): Driver {
    return new SplitSqliteDriver(this.writer, this.reader);
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
