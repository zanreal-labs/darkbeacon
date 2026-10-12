/**
 * OpenTelemetry settings, read from the standard `OTEL_*` variables plus Darkbeacon's own
 * switches (`OTEL_ENABLED`, `METRICS_PROMETHEUS`, `METRICS_TOKEN`). Pure and dependency-free:
 * the preload reads it before anything else is loaded, and nothing of the SDK is loaded when
 * it says telemetry is off. See docs/observability.md.
 */

/** Environment variables (`process.env`). */
export type Env = Readonly<Record<string, string | undefined>>;

export type OtlpProtocol = 'http/protobuf' | 'http/json' | 'grpc';
export type Signal = 'traces' | 'metrics' | 'logs';
export const SIGNALS: readonly Signal[] = ['traces', 'metrics', 'logs'];

export interface TelemetrySettings {
  /** Something to start: OTLP export of at least one signal, or the Prometheus endpoint. */
  enabled: boolean;
  serviceName: string;
  /** Per signal: exported over OTLP (with this protocol), to the console, or not at all. */
  signals: Record<Signal, { exporter: 'otlp'; protocol: OtlpProtocol } | { exporter: 'console' } | null>;
  /** `host:port` the OTLP exporters send to, for display (never the path, headers or credentials). */
  endpointHost: string | null;
  /** Prometheus scrape endpoint at `/metrics`, behind a bearer token. */
  prometheus: { token: string } | null;
  /** OTEL_METRIC_EXPORT_INTERVAL / OTEL_METRIC_EXPORT_TIMEOUT, in ms. */
  metricExport: { intervalMs: number; timeoutMs: number };
}

export interface ParsedTelemetrySettings {
  settings: TelemetrySettings;
  /** Settings that cannot work, as `NAME: problem` lines; the server refuses to start with any. */
  problems: string[];
}

export const DEFAULT_SERVICE_NAME = 'darkbeacon';
export const METRICS_PATH = '/metrics';
const MIN_TOKEN_LENGTH = 16;
const PROTOCOLS: readonly OtlpProtocol[] = ['http/protobuf', 'http/json', 'grpc'];
const TRUE = new Set(['true', '1', 'yes']);
const FALSE = new Set(['false', '0', 'no']);

const env = (vars: Env, name: string): string | undefined => {
  const value = vars[name]?.trim();
  return value ? value : undefined;
};

function flag(vars: Env, name: string, problems: string[]): boolean | undefined {
  const value = env(vars, name)?.toLowerCase();
  if (value === undefined) return undefined;
  if (TRUE.has(value)) return true;
  if (FALSE.has(value)) return false;
  problems.push(`${name}: must be true or false`);
  return undefined;
}

/** `OTEL_*_EXPORTER`: a comma separated list, `otlp` when unset. */
function exporters(vars: Env, name: string): string[] {
  const value = env(vars, name);
  return value
    ? value
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    : ['otlp'];
}

function protocolOf(vars: Env, signal: Signal, problems: string[]): OtlpProtocol {
  const own = `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_PROTOCOL`;
  const name = env(vars, own) ? own : 'OTEL_EXPORTER_OTLP_PROTOCOL';
  const value = env(vars, name) ?? 'http/protobuf';
  if ((PROTOCOLS as readonly string[]).includes(value)) return value as OtlpProtocol;
  problems.push(`${name}: must be one of ${PROTOCOLS.join(', ')}`);
  return 'http/protobuf';
}

const ENDPOINT_VARS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
];

/** `service.name` from OTEL_RESOURCE_ATTRIBUTES (`k=v,k=v`, values percent-encoded). */
function resourceServiceName(vars: Env): string | undefined {
  for (const pair of env(vars, 'OTEL_RESOURCE_ATTRIBUTES')?.split(',') ?? []) {
    const [key, ...rest] = pair.split('=');
    if (key?.trim() !== 'service.name') continue;
    try {
      return decodeURIComponent(rest.join('=').trim()) || undefined;
    } catch {
      return rest.join('=').trim() || undefined;
    }
  }
  return undefined;
}

function millis(vars: Env, name: string, fallback: number, problems: string[]): number {
  const value = env(vars, name);
  if (value === undefined) return fallback;
  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;
  problems.push(`${name}: must be a positive number of milliseconds`);
  return fallback;
}

/** The `host:port` of an endpoint URL; null when it is not one. */
export function endpointHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host : null;
  } catch {
    return null;
  }
}

/**
 * When telemetry runs:
 * - `OTEL_SDK_DISABLED=true` turns everything off (the standard kill switch);
 * - OTLP export is on with `OTEL_ENABLED=true`, or as soon as an `OTEL_EXPORTER_OTLP_*ENDPOINT`
 *   is set (unless `OTEL_ENABLED=false`);
 * - the Prometheus endpoint is on with `METRICS_PROMETHEUS=true` or `OTEL_METRICS_EXPORTER`
 *   naming `prometheus`, and needs `METRICS_TOKEN`.
 */
export function parseTelemetrySettings(vars: Env): ParsedTelemetrySettings {
  const problems: string[] = [];
  const disabled = flag(vars, 'OTEL_SDK_DISABLED', problems) === true;
  const switched = flag(vars, 'OTEL_ENABLED', problems);
  const endpoints = ENDPOINT_VARS.filter((name) => env(vars, name) !== undefined);
  for (const name of endpoints) {
    if (endpointHost(env(vars, name)!) === null) problems.push(`${name}: must be an http(s) URL`);
  }
  const otlpOn = !disabled && (switched ?? endpoints.length > 0);

  const metricExporters = exporters(vars, 'OTEL_METRICS_EXPORTER');
  const prometheusOn =
    !disabled &&
    (flag(vars, 'METRICS_PROMETHEUS', problems) === true || metricExporters.includes('prometheus'));
  const token = env(vars, 'METRICS_TOKEN');
  if (prometheusOn && !token) {
    problems.push(
      'METRICS_TOKEN: required with the Prometheus endpoint (scrapers send it as a bearer token)',
    );
  } else if (prometheusOn && token!.length < MIN_TOKEN_LENGTH) {
    problems.push(`METRICS_TOKEN: must be at least ${MIN_TOKEN_LENGTH} characters`);
  }

  const signals = {} as TelemetrySettings['signals'];
  for (const signal of SIGNALS) {
    const name = `OTEL_${signal.toUpperCase()}_EXPORTER`;
    const list = signal === 'metrics' ? metricExporters : exporters(vars, name);
    const known =
      signal === 'metrics' ? ['otlp', 'console', 'none', 'prometheus'] : ['otlp', 'console', 'none'];
    const unknown = list.filter((e) => !known.includes(e));
    if (unknown.length > 0)
      problems.push(`${name}: unknown exporter ${unknown.join(', ')} (${known.join(', ')})`);
    const protocol = protocolOf(vars, signal, problems);
    signals[signal] =
      !otlpOn || list.includes('none')
        ? null
        : list.includes('otlp')
          ? { exporter: 'otlp', protocol }
          : list.includes('console')
            ? { exporter: 'console' }
            : null;
  }

  const general = env(vars, 'OTEL_EXPORTER_OTLP_ENDPOINT');
  const own = SIGNALS.map((s) => env(vars, `OTEL_EXPORTER_OTLP_${s.toUpperCase()}_ENDPOINT`)).find(Boolean);
  const anyOtlp = SIGNALS.map((s) => signals[s]).find((s) => s?.exporter === 'otlp');
  const endpoint =
    general ??
    own ??
    (anyOtlp?.exporter === 'otlp'
      ? anyOtlp.protocol === 'grpc'
        ? 'http://localhost:4317'
        : 'http://localhost:4318'
      : undefined);

  const settings: TelemetrySettings = {
    enabled: otlpOn || prometheusOn,
    serviceName: env(vars, 'OTEL_SERVICE_NAME') ?? resourceServiceName(vars) ?? DEFAULT_SERVICE_NAME,
    signals,
    endpointHost: anyOtlp && endpoint ? endpointHost(endpoint) : null,
    prometheus: prometheusOn && token ? { token } : null,
    metricExport: {
      intervalMs: millis(vars, 'OTEL_METRIC_EXPORT_INTERVAL', 60_000, problems),
      timeoutMs: millis(vars, 'OTEL_METRIC_EXPORT_TIMEOUT', 30_000, problems),
    },
  };
  return { settings, problems: [...new Set(problems)] };
}
