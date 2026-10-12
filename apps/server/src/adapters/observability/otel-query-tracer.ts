import { SpanKind, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';
import type { QueryTracer } from '@darkbeacon/db';

const MAX_QUERY_TEXT = 2_000;

/**
 * Database client spans for SQLite (better-sqlite3 has no maintained instrumentation), named
 * and attributed after the database semantic conventions. Only statements run while serving
 * something get a span, like `requireParentSpan` of the pg instrumentation: background polls
 * would otherwise start a trace every second. The text is Kysely's compiled SQL, with
 * placeholders instead of values.
 */
export function otelQueryTracer(tracer: Tracer): QueryTracer {
  return {
    query(statement, run) {
      if (!trace.getActiveSpan()) return run();
      const operation = statement.operation.toUpperCase();
      return tracer.startActiveSpan(
        operation,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'db.system.name': statement.dialect === 'postgres' ? 'postgresql' : 'sqlite',
            'db.operation.name': operation,
            'db.query.text': statement.sql.slice(0, MAX_QUERY_TEXT),
          },
        },
        async (span) => {
          try {
            return await run();
          } catch (error) {
            span.recordException(error instanceof Error ? error : String(error));
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };
}
