import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { trace } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { newEvent, type EventLog } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { parseTelemetrySettings } from '@darkbeacon/observability';
import { OtelInstruments, OtelSpanTracer } from '../../adapters/observability/otel-instruments.js';
import {
  setTelemetryRuntime,
  stoppedRuntime,
  type TelemetryRuntime,
} from '../../adapters/observability/runtime.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';
import { EVENT_LOG } from '../../platform/tokens.js';

const TOKEN = 'scrape-token-for-the-tests';

/** A running runtime with real metrics behind a Prometheus exporter, as the SDK adapter builds it. */
function prometheusRuntime(): TelemetryRuntime & { provider: MeterProvider } {
  const settings = parseTelemetrySettings({ METRICS_PROMETHEUS: 'true', METRICS_TOKEN: TOKEN }).settings;
  const exporter = new PrometheusExporter({ preventServerStart: true });
  const provider = new MeterProvider({ readers: [exporter] });
  return {
    ...stoppedRuntime(settings),
    running: true,
    instruments: new OtelInstruments(provider.getMeter('darkbeacon')),
    tracer: new OtelSpanTracer(trace.getTracer('test')),
    scrape: (request, response) => exporter.getMetricsRequestHandler(request, response),
    provider,
    shutdown: () => provider.shutdown(),
  };
}

describeEachDialect('observability', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  async function start(runtime: TelemetryRuntime) {
    setTelemetryRuntime(runtime);
    const config = { ...parseEnv({ NODE_ENV: 'test' }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false });
    app
      .get(ActorResolverRegistry)
      .use(async (req) =>
        req.headers.authorization === 'Bearer admin'
          ? { kind: 'account', id: 'admin', instanceRole: 'admin' }
          : req.headers.authorization === 'Bearer user'
            ? { kind: 'account', id: 'user', instanceRole: 'user' }
            : null,
      );
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await app?.close();
    setTelemetryRuntime(null);
  });

  it('serves /metrics only with the token, with the domain metrics in it', async () => {
    const runtime = prometheusRuntime();
    await start(runtime);

    const anonymous = await fetch(`${base}/metrics`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toMatch(/^Bearer/);
    const wrong = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);

    await app.get<EventLog>(EVENT_LOG).append([
      newEvent({
        stream: 'instance',
        type: 'access.role_changed',
        actor: { kind: 'system', id: 'test' },
        data: { accountId: 'a', role: 'admin' },
        occurredAt: Date.now(),
      }),
    ]);
    await vi.waitFor(async () => {
      const scraped = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
      expect(scraped.status).toBe(200);
      const text = await scraped.text();
      expect(text).toMatch(
        /darkbeacon_events_appended[a-z_]*\{[^}]*event_type="access\.role_changed"[^}]*\} 1/,
      );
      expect(text).toMatch(/darkbeacon_maps(\{[^}]*\})? 0/);
      expect(text).toMatch(/darkbeacon_realtime_connections(\{[^}]*\})? 0/);
    });
    await runtime.provider.shutdown();
  });

  it('shows admins what is exported, and nobody else', async () => {
    await start(prometheusRuntime());
    const status = await fetch(`${base}/api/admin/observability`, {
      headers: { authorization: 'Bearer admin' },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      enabled: true,
      notLoaded: false,
      serviceName: 'darkbeacon',
      otlp: { endpoint: null, protocol: null, signals: [] },
      prometheus: { enabled: true, path: '/metrics' },
    });
    expect(
      (await fetch(`${base}/api/admin/observability`, { headers: { authorization: 'Bearer user' } })).status,
    ).toBe(403);
    expect((await fetch(`${base}/api/admin/observability`)).status).toBe(401);
  });

  it('has no /metrics while telemetry is off, and is ready once migrated', async () => {
    await start(stoppedRuntime(parseTelemetrySettings({}).settings));
    expect((await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(
      404,
    );
    const status = await fetch(`${base}/api/admin/observability`, {
      headers: { authorization: 'Bearer admin' },
    });
    expect(await status.json()).toMatchObject({ enabled: false, prometheus: { enabled: false } });

    const ready = await fetch(`${base}/api/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ready',
      database: t.dialect,
      migrations: { pending: 0 },
    });
  });
});
