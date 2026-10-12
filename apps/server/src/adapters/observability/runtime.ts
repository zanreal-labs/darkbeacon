import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QueryTracer } from '@darkbeacon/db';
import {
  parseTelemetrySettings,
  type MetricInstruments,
  type SpanTracer,
  type TelemetrySettings,
} from '@darkbeacon/observability';

/**
 * Telemetry as it runs in this process. The preload (`preload.ts`) starts the SDK before the
 * application is imported and leaves its parts here; the application reads them. This file
 * loads nothing of the SDK, so it costs nothing while telemetry is off.
 */
export interface TelemetryRuntime {
  settings: TelemetrySettings;
  /** The SDK started. */
  running: boolean;
  instruments: MetricInstruments | null;
  tracer: SpanTracer | null;
  /** Spans for SQLite statements (better-sqlite3 has no instrumentation). */
  queryTracer: QueryTracer | null;
  /** Logs go out over OTLP: the application logs through the bridge. */
  logs: boolean;
  /** Answers a Prometheus scrape (text exposition format); null without the endpoint. */
  scrape: ((request: IncomingMessage, response: ServerResponse) => void) | null;
  /** Pushes out what is buffered (spans, logs, metrics). */
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export function stoppedRuntime(settings: TelemetrySettings): TelemetryRuntime {
  return {
    settings,
    running: false,
    instruments: null,
    tracer: null,
    queryTracer: null,
    logs: false,
    scrape: null,
    flush: async () => {},
    shutdown: async () => {},
  };
}

let current: TelemetryRuntime | null = null;

/** The process's telemetry; stopped (settings from the environment) unless the preload started it. */
export function telemetryRuntime(): TelemetryRuntime {
  return (current ??= stoppedRuntime(parseTelemetrySettings(process.env).settings));
}

/** Installs the started runtime (the preload), or another one in tests; null resets it. */
export function setTelemetryRuntime(runtime: TelemetryRuntime | null): void {
  current = runtime;
}

/**
 * Telemetry settings for the web app's server, which the API server starts: traces only (the
 * API server reports metrics and logs, the web server's output included), under
 * `<service>-web`; nothing at all while the API server exports no traces.
 */
export function webTelemetryEnv(runtime: TelemetryRuntime): NodeJS.ProcessEnv {
  if (!runtime.running || runtime.settings.signals.traces === null) return { OTEL_SDK_DISABLED: 'true' };
  return {
    OTEL_ENABLED: 'true',
    OTEL_SERVICE_NAME: `${runtime.settings.serviceName}-web`,
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
  };
}
