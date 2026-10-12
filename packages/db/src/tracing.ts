import type { DatabaseConnection, Dialect as KyselyDialect, Driver } from 'kysely';

/** One statement as a tracer sees it: the compiled SQL with placeholders, never the values. */
export interface TracedStatement {
  sql: string;
  /** `select`, `insert`, `begin`... (the first keyword, lower case). */
  operation: string;
  dialect: 'sqlite' | 'postgres';
}

/**
 * Wraps every statement the database runs, e.g. in a trace span. Used where no driver
 * instrumentation exists (better-sqlite3); Postgres is traced by the `pg` instrumentation.
 */
export interface QueryTracer {
  query<T>(statement: TracedStatement, run: () => Promise<T>): Promise<T>;
}

/** The first SQL keyword, lower case (`select`, `with`, `insert`...). */
export function sqlOperation(sql: string): string {
  return /^\s*(?:\/\*.*?\*\/\s*)?([a-z]+)/i.exec(sql)?.[1]?.toLowerCase() ?? 'query';
}

/**
 * A Kysely dialect whose connections run every query through `tracer`. Everything else (the
 * compiler, adapter, introspector, transactions) is the wrapped dialect's own.
 */
export function tracedDialect(
  inner: KyselyDialect,
  tracer: QueryTracer,
  dialect: TracedStatement['dialect'],
): KyselyDialect {
  const wrap = (connection: DatabaseConnection): DatabaseConnection => {
    const known = wrapped.get(connection);
    if (known) return known;
    const proxy = new Proxy(connection, {
      get(target, property) {
        if (property === 'executeQuery') {
          return (query: Parameters<DatabaseConnection['executeQuery']>[0], options?: never) =>
            tracer.query({ sql: query.sql, operation: sqlOperation(query.sql), dialect }, () =>
              target.executeQuery(query, options),
            );
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    wrapped.set(connection, proxy);
    return proxy;
  };
  const wrapped = new WeakMap<DatabaseConnection, DatabaseConnection>();
  return {
    createAdapter: () => inner.createAdapter(),
    createQueryCompiler: () => inner.createQueryCompiler(),
    createIntrospector: (db) => inner.createIntrospector(db),
    createDriver: (): Driver => {
      const driver = inner.createDriver();
      return new Proxy(driver, {
        get(target, property) {
          if (property === 'acquireConnection') {
            return async (...args: Parameters<Driver['acquireConnection']>) =>
              wrap(await target.acquireConnection(...args));
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    },
  };
}
