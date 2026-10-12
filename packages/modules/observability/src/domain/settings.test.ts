import { describe, expect, it } from 'vitest';
import { channelLabel, esiRoute, scrapeAuthorized } from './index.js';
import { parseTelemetrySettings } from './settings.js';
import { observabilityStatus } from './status.js';

const TOKEN = 'a-scrape-token-of-some-length';

describe('telemetry settings', () => {
  it('is off by default', () => {
    const { settings, problems } = parseTelemetrySettings({});
    expect(problems).toEqual([]);
    expect(settings).toMatchObject({
      enabled: false,
      serviceName: 'darkbeacon',
      signals: { traces: null, metrics: null, logs: null },
      endpointHost: null,
      prometheus: null,
      metricExport: { intervalMs: 60_000, timeoutMs: 30_000 },
    });
  });

  it('turns on with an OTLP endpoint, over http/protobuf, every signal', () => {
    const { settings, problems } = parseTelemetrySettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:secret@otlp.example.net:4318/otlp',
    });
    expect(problems).toEqual([]);
    expect(settings.enabled).toBe(true);
    expect(settings.endpointHost).toBe('otlp.example.net:4318');
    for (const signal of ['traces', 'metrics', 'logs'] as const)
      expect(settings.signals[signal]).toEqual({ exporter: 'otlp', protocol: 'http/protobuf' });
  });

  it('turns on with OTEL_ENABLED alone (local collector) and stays off with OTEL_ENABLED=false', () => {
    expect(parseTelemetrySettings({ OTEL_ENABLED: 'true' }).settings).toMatchObject({
      enabled: true,
      endpointHost: 'localhost:4318',
    });
    expect(
      parseTelemetrySettings({ OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }).settings
        .endpointHost,
    ).toBe('localhost:4317');
    expect(
      parseTelemetrySettings({ OTEL_ENABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318' }).settings
        .enabled,
    ).toBe(false);
  });

  it('honours OTEL_SDK_DISABLED over everything', () => {
    const { settings } = parseTelemetrySettings({
      OTEL_SDK_DISABLED: 'true',
      OTEL_ENABLED: 'true',
      METRICS_PROMETHEUS: 'true',
      METRICS_TOKEN: TOKEN,
    });
    expect(settings.enabled).toBe(false);
    expect(settings.prometheus).toBeNull();
  });

  it('reads per-signal exporters and protocols', () => {
    const { settings, problems } = parseTelemetrySettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4317',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_TRACES_EXPORTER: 'console',
    });
    expect(problems).toEqual([]);
    expect(settings.signals).toEqual({
      traces: { exporter: 'console' },
      metrics: null,
      logs: { exporter: 'otlp', protocol: 'http/json' },
    });
  });

  it('takes the service name from OTEL_SERVICE_NAME, then OTEL_RESOURCE_ATTRIBUTES', () => {
    expect(parseTelemetrySettings({ OTEL_SERVICE_NAME: 'beacon-eu' }).settings.serviceName).toBe('beacon-eu');
    expect(
      parseTelemetrySettings({
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=prod,service.name=my%20map',
      }).settings.serviceName,
    ).toBe('my map');
  });

  it('serves Prometheus only with a token', () => {
    expect(parseTelemetrySettings({ METRICS_PROMETHEUS: 'true' }).problems).toEqual([
      expect.stringMatching(/^METRICS_TOKEN: required/),
    ]);
    expect(
      parseTelemetrySettings({ OTEL_METRICS_EXPORTER: 'prometheus', METRICS_TOKEN: 'short' }).problems,
    ).toEqual([expect.stringMatching(/^METRICS_TOKEN: must be at least 16/)]);
    const { settings, problems } = parseTelemetrySettings({
      METRICS_PROMETHEUS: 'true',
      METRICS_TOKEN: TOKEN,
    });
    expect(problems).toEqual([]);
    // Prometheus alone starts telemetry, but nothing goes out over OTLP.
    expect(settings).toMatchObject({ enabled: true, prometheus: { token: TOKEN }, endpointHost: null });
    expect(settings.signals.metrics).toBeNull();
  });

  it('lists every problem', () => {
    const { problems } = parseTelemetrySettings({
      OTEL_ENABLED: 'maybe',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'thrift',
      OTEL_LOGS_EXPORTER: 'kafka',
      OTEL_METRIC_EXPORT_INTERVAL: '-5',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'OTEL_ENABLED: must be true or false',
        'OTEL_EXPORTER_OTLP_ENDPOINT: must be an http(s) URL',
        expect.stringMatching(/^OTEL_EXPORTER_OTLP_PROTOCOL: must be one of/),
        expect.stringMatching(/^OTEL_LOGS_EXPORTER: unknown exporter kafka/),
        expect.stringMatching(/^OTEL_METRIC_EXPORT_INTERVAL/),
      ]),
    );
  });
});

describe('observability status', () => {
  it('shows the endpoint host and never headers or tokens', () => {
    const { settings } = parseTelemetrySettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway.grafana.net/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic c2VjcmV0',
      METRICS_PROMETHEUS: 'true',
      METRICS_TOKEN: TOKEN,
    });
    const status = observabilityStatus(settings, true);
    expect(status).toEqual({
      enabled: true,
      notLoaded: false,
      serviceName: 'darkbeacon',
      otlp: {
        endpoint: 'otlp-gateway.grafana.net',
        protocol: 'http/protobuf',
        signals: ['traces', 'metrics', 'logs'],
      },
      prometheus: { enabled: true, path: '/metrics' },
    });
    expect(JSON.stringify(status)).not.toMatch(/c2VjcmV0|scrape-token/);
  });

  it('tells configured-but-not-started apart from off', () => {
    const { settings } = parseTelemetrySettings({ OTEL_ENABLED: 'true' });
    expect(observabilityStatus(settings, false)).toMatchObject({ enabled: false, notLoaded: true });
    expect(observabilityStatus(parseTelemetrySettings({}).settings, false)).toMatchObject({
      enabled: false,
      notLoaded: false,
      otlp: { endpoint: null, protocol: null, signals: [] },
    });
  });
});

describe('labels', () => {
  it('folds ESI URLs into route templates', () => {
    expect(esiRoute('https://esi.evetech.net/characters/2112000001/location')).toBe(
      '/characters/{id}/location',
    );
    expect(esiRoute('https://esi.evetech.net/latest/universe/systems/30000142/?datasource=tranquility')).toBe(
      '/universe/systems/{id}',
    );
    expect(esiRoute('https://esi.evetech.net/universe/names')).toBe('/universe/names');
    expect(esiRoute('https://discord.com/api/webhooks/1/x')).toBeNull();
    expect(esiRoute('not a url')).toBeNull();
  });

  it('keeps channel names short and plain', () => {
    expect(channelLabel('Discord')).toBe('discord');
    expect(channelLabel('a b')).toBe('other');
    expect(channelLabel('x'.repeat(40))).toBe('other');
  });

  it('checks the scrape bearer token', () => {
    expect(scrapeAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(scrapeAuthorized(`bearer  ${TOKEN} `, TOKEN)).toBe(true);
    expect(scrapeAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(scrapeAuthorized(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(scrapeAuthorized(undefined, TOKEN)).toBe(false);
    expect(scrapeAuthorized('Bearer ', TOKEN)).toBe(false);
  });
});
