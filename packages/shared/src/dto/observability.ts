import { z } from 'zod';

export const TelemetrySignal = z.enum(['traces', 'metrics', 'logs']);
export type TelemetrySignal = z.infer<typeof TelemetrySignal>;

/**
 * What this instance exports for monitoring (OpenTelemetry), read-only for instance admins. It
 * never carries exporter headers, tokens or credentials; the endpoint is its host only.
 */
export const ObservabilityDto = z.object({
  /** Telemetry runs in this process. */
  enabled: z.boolean(),
  /**
   * The environment turns telemetry on but it did not start: the server was run without the
   * preload (`node --import ./dist/adapters/observability/preload.js`).
   */
  notLoaded: z.boolean(),
  serviceName: z.string(),
  otlp: z.object({
    /** `host:port` the exporters send to; null when nothing goes out over OTLP. */
    endpoint: z.string().nullable(),
    protocol: z.enum(['http/protobuf', 'http/json', 'grpc']).nullable(),
    /** Signals sent over OTLP. */
    signals: z.array(TelemetrySignal),
  }),
  prometheus: z.object({
    enabled: z.boolean(),
    /** Scrape path on the instance's own port, behind `Authorization: Bearer <METRICS_TOKEN>`. */
    path: z.string(),
  }),
});
export type ObservabilityDto = z.infer<typeof ObservabilityDto>;
