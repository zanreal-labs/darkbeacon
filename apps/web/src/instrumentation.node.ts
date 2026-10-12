import { NodeSDK } from '@opentelemetry/sdk-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

/**
 * Traces of the web app's server. Next.js makes the spans of a request (rendering, its fetches)
 * and continues the trace the API server's proxy hop sends in `traceparent`; the undici
 * instrumentation passes the trace on to the API with every server-side fetch, so one page view
 * is one trace across both processes. Exporter, protocol, sampler and resource come from the
 * standard `OTEL_*` variables; metrics and logs are left to the API server.
 */
const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'darkbeacon-web',
  metricReaders: [],
  logRecordProcessors: [],
  instrumentations: [
    new UndiciInstrumentation({
      ignoreRequestHook: (request) => request.path.split('?')[0] === '/api/health',
    }),
  ],
});
sdk.start();
