import type { IncomingMessage } from 'node:http';
import { register as registerSyncHooks, supportsSyncHooks } from 'import-in-the-middle/register-hooks.mjs';
import { createAddHookMessageChannel } from 'import-in-the-middle';
import { register as registerAsyncHooks } from 'node:module';
import { metrics, trace } from '@opentelemetry/api';
import { logs as otelLogs } from '@opentelemetry/api-logs';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import {
  ConsoleLogRecordExporter,
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
  type IMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { METRICS_PATH, type OtlpProtocol, type TelemetrySettings } from '@darkbeacon/observability';
import { OtelInstruments, OtelSpanTracer } from './otel-instruments.js';
import { otelQueryTracer } from './otel-query-tracer.js';
import type { TelemetryRuntime } from './runtime.js';

/** Paths that are polled all day long and would only add noise to traces. */
const QUIET_PATHS = new Set(['/api/health', '/api/ready', METRICS_PATH, '/healthz']);
const pathOf = (url: string | undefined) => (url ?? '/').split('?')[0]!;

/**
 * Modules the ESM application imports that the instrumentations patch (CommonJS ones nested
 * inside them are seen anyway). `node:http` matters: the web proxy and webhook sender import
 * `request` from it, and only a hooked import sees the patched function.
 */
const ESM_IMPORTED = ['pg', 'fastify', '@nestjs/core', 'http', 'https', 'node:http', 'node:https'];

/**
 * Lets the instrumentations patch packages the ESM application imports: in-thread loader hooks
 * where Node supports them, the off-thread loader otherwise.
 */
async function hookEsmImports(): Promise<() => Promise<void>> {
  if (supportsSyncHooks()) {
    registerSyncHooks({ include: ESM_IMPORTED });
    return async () => {};
  }
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  registerAsyncHooks('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);
  return waitForAllMessagesAcknowledged;
}

async function spanExporter(protocol: OtlpProtocol) {
  if (protocol === 'grpc')
    return new (await import('@opentelemetry/exporter-trace-otlp-grpc')).OTLPTraceExporter();
  if (protocol === 'http/json')
    return new (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter();
  return new (await import('@opentelemetry/exporter-trace-otlp-proto')).OTLPTraceExporter();
}

async function metricExporter(protocol: OtlpProtocol): Promise<PushMetricExporter> {
  if (protocol === 'grpc')
    return new (await import('@opentelemetry/exporter-metrics-otlp-grpc')).OTLPMetricExporter();
  if (protocol === 'http/json')
    return new (await import('@opentelemetry/exporter-metrics-otlp-http')).OTLPMetricExporter();
  return new (await import('@opentelemetry/exporter-metrics-otlp-proto')).OTLPMetricExporter();
}

async function logExporter(protocol: OtlpProtocol) {
  if (protocol === 'grpc')
    return new (await import('@opentelemetry/exporter-logs-otlp-grpc')).OTLPLogExporter();
  if (protocol === 'http/json')
    return new (await import('@opentelemetry/exporter-logs-otlp-http')).OTLPLogExporter();
  return new (await import('@opentelemetry/exporter-logs-otlp-proto')).OTLPLogExporter();
}

/**
 * Starts the OpenTelemetry Node SDK for the server. Exporters read their endpoint, headers,
 * timeouts and TLS settings from the standard `OTEL_EXPORTER_OTLP_*` variables themselves;
 * the sampler comes from `OTEL_TRACES_SAMPLER`, resource attributes from `OTEL_RESOURCE_ATTRIBUTES`.
 */
export async function startOtel(settings: TelemetrySettings): Promise<TelemetryRuntime> {
  const hooksReady = await hookEsmImports();
  const { traces, metrics: metricSignal, logs } = settings.signals;

  const spanProcessors =
    traces === null
      ? []
      : traces.exporter === 'console'
        ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
        : [new BatchSpanProcessor(await spanExporter(traces.protocol))];

  const metricReaders: IMetricReader[] = [];
  const { intervalMs, timeoutMs } = settings.metricExport;
  if (metricSignal !== null) {
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter:
          metricSignal.exporter === 'console'
            ? new ConsoleMetricExporter()
            : await metricExporter(metricSignal.protocol),
        exportIntervalMillis: intervalMs,
        exportTimeoutMillis: Math.min(timeoutMs, intervalMs),
      }),
    );
  }
  // Served by the API's own port at /metrics (behind the token), never on a port of its own.
  const prometheus = settings.prometheus ? new PrometheusExporter({ preventServerStart: true }) : null;
  if (prometheus) metricReaders.push(prometheus);

  const logRecordProcessors =
    logs === null
      ? []
      : logs.exporter === 'console'
        ? [new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() })]
        : [new BatchLogRecordProcessor({ exporter: await logExporter(logs.protocol) })];

  const sdk = new NodeSDK({
    serviceName: settings.serviceName,
    spanProcessors,
    metricReaders,
    logRecordProcessors,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request: IncomingMessage) => QUIET_PATHS.has(pathOf(request.url)),
      }),
      // fetch: ESI, Discord, EVE SSO; the web server's /healthz (asked by /api/health) stays quiet.
      new UndiciInstrumentation({
        ignoreRequestHook: (request) => QUIET_PATHS.has(pathOf(request.path)),
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: (route) => QUIET_PATHS.has(pathOf(route.url)),
      }),
      new NestInstrumentation(),
      // Spans only for queries made while serving something, not for every background poll.
      new PgInstrumentation({ requireParentSpan: true }),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();
  await hooksReady();

  const flush = async () => {
    const providers = [
      trace.getTracerProvider(),
      metrics.getMeterProvider(),
      otelLogs.getLoggerProvider(),
    ] as Array<{
      forceFlush?: () => Promise<void>;
    }>;
    await Promise.allSettled(providers.map((p) => p.forceFlush?.()));
  };

  return {
    settings,
    running: true,
    instruments: new OtelInstruments(metrics.getMeter('darkbeacon')),
    tracer: new OtelSpanTracer(trace.getTracer('darkbeacon')),
    queryTracer: traces === null ? null : otelQueryTracer(trace.getTracer('darkbeacon.db')),
    logs: logs !== null,
    scrape: prometheus ? (request, response) => prometheus.getMetricsRequestHandler(request, response) : null,
    flush,
    shutdown: () => sdk.shutdown(),
  };
}
