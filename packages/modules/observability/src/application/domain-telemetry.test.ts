import { describe, expect, it } from 'vitest';
import { ForbiddenError, UnauthenticatedError, type Actor } from '@darkbeacon/core';
import { parseTelemetrySettings } from '../domain/settings.js';
import type {
  GaugeReport,
  MetricInstruments,
  SpanTracer,
  TelemetryAttributes,
} from '../ports/instruments.js';
import { DomainTelemetry } from './domain-telemetry.js';
import { ObservabilityStatusService } from './observability-status.js';

/** Instruments that keep every measurement, for assertions. */
function recording() {
  const points: Array<{ name: string; value: number; attributes: TelemetryAttributes }> = [];
  const reads: Array<(report: GaugeReport<string>) => Promise<void>> = [];
  const gaugeNames: Record<string, string> = {};
  const sink =
    (name: string) =>
    (value: number, attributes: TelemetryAttributes = {}) =>
      points.push({ name, value, attributes });
  const instruments: MetricInstruments = {
    counter: (name) => ({ add: sink(name) }),
    upDownCounter: (name) => ({ add: sink(name) }),
    histogram: (name) => ({ record: sink(name) }),
    gauge: (name) => ({ record: sink(name) }),
    observe: (gauges, read) => {
      for (const [key, g] of Object.entries<{ name: string }>(gauges)) gaugeNames[key] = g.name;
      reads.push(read as (report: GaugeReport<string>) => Promise<void>);
      return () => void reads.splice(reads.indexOf(read as never), 1);
    },
  };
  const spans: string[] = [];
  const tracer: SpanTracer = {
    span: (name, _attributes, work) => {
      spans.push(name);
      return work();
    },
  };
  const collect = async () => {
    for (const read of reads)
      await read((key, value, attributes = {}) => sink(gaugeNames[key]!)(value, attributes));
  };
  const sum = (name: string, attributes: TelemetryAttributes = {}) =>
    points
      .filter((p) => p.name === name && Object.entries(attributes).every(([k, v]) => p.attributes[k] === v))
      .reduce((total, p) => total + p.value, 0);
  return { instruments, tracer, points, spans, collect, sum, reads };
}

describe('DomainTelemetry', () => {
  it('counts committed events by type', () => {
    const r = recording();
    const telemetry = new DomainTelemetry(r);
    telemetry.eventsCommitted([{ type: 'system.added' }, { type: 'system.added' }, { type: 'ping.created' }]);
    expect(r.sum('darkbeacon.events.appended', { 'event.type': 'system.added' })).toBe(2);
    expect(r.sum('darkbeacon.events.appended', { 'event.type': 'ping.created' })).toBe(1);
  });

  it('counts deliveries by channel and outcome', () => {
    const r = recording();
    const telemetry = new DomainTelemetry(r);
    telemetry.notificationDelivered('webhook', true);
    telemetry.notificationDelivered('Discord', false);
    telemetry.notificationDelivered('discord', true);
    expect(r.sum('darkbeacon.notifications.deliveries', { channel: 'webhook', outcome: 'ok' })).toBe(1);
    expect(r.sum('darkbeacon.notifications.deliveries', { channel: 'discord', outcome: 'failed' })).toBe(1);
    expect(r.sum('darkbeacon.notifications.deliveries', { channel: 'discord' })).toBe(2);
  });

  it('records ESI requests, errors, latency and the limits ESI reports, with route templates', () => {
    const r = recording();
    const telemetry = new DomainTelemetry(r);
    const headers: Record<string, string> = {
      'x-esi-error-limit-remain': '93',
      'x-ratelimit-group': 'char-location',
      'x-ratelimit-remaining': '17',
    };
    telemetry.esiExchange({
      url: 'https://esi.evetech.net/characters/2112000001/location',
      status: 200,
      seconds: 0.12,
      header: (name) => headers[name] ?? null,
    });
    telemetry.esiExchange({
      url: 'https://esi.evetech.net/characters/2112000002/ship',
      status: 502,
      seconds: 1,
    });
    telemetry.esiExchange({
      url: 'https://esi.evetech.net/characters/2112000002/online',
      status: null,
      seconds: 10,
      errorType: 'UND_ERR_CONNECT_TIMEOUT',
    });
    telemetry.esiExchange({ url: 'https://login.eveonline.com/v2/oauth/token', status: 200, seconds: 1 });

    expect(r.sum('darkbeacon.esi.requests')).toBe(3);
    expect(r.sum('darkbeacon.esi.requests', { 'esi.route': '/characters/{id}/location' })).toBe(1);
    expect(r.sum('darkbeacon.esi.errors', { 'error.type': '502' })).toBe(1);
    expect(r.sum('darkbeacon.esi.errors', { 'error.type': 'UND_ERR_CONNECT_TIMEOUT' })).toBe(1);
    expect(r.points.filter((p) => p.name === 'darkbeacon.esi.request.duration')).toHaveLength(3);
    expect(r.sum('darkbeacon.esi.error_limit.remaining')).toBe(93);
    expect(r.sum('darkbeacon.esi.rate_limit.remaining', { 'esi.rate_limit.group': 'char-location' })).toBe(
      17,
    );
    // No character ids anywhere.
    expect(JSON.stringify(r.points)).not.toMatch(/2112000/);
  });

  it('records tracking polls and reports the gauges on collection', async () => {
    const r = recording();
    const telemetry = new DomainTelemetry(r);
    telemetry.trackingPolled(0.4);
    expect(r.sum('darkbeacon.tracking.poll.duration')).toBe(0.4);

    const stop = telemetry.observe({
      onlineCharacters: async () => 3,
      maps: async () => 2,
      consumerLag: async () => [
        { consumer: 'webhooks', behind: 5 },
        { consumer: 'auto-mapping', behind: 0 },
      ],
      realtimeConnections: () => 4,
    });
    await r.collect();
    expect(r.sum('darkbeacon.characters.online')).toBe(3);
    expect(r.sum('darkbeacon.maps')).toBe(2);
    expect(r.sum('darkbeacon.event_consumer.lag', { consumer: 'webhooks' })).toBe(5);
    expect(r.sum('darkbeacon.realtime.connections')).toBe(4);
    stop();
    expect(r.reads).toHaveLength(0);
  });

  it('wraps work in spans', async () => {
    const r = recording();
    const telemetry = new DomainTelemetry(r);
    expect(await telemetry.traced('ws subscribe', { 'darkbeacon.stream.kind': 'map' }, async () => 7)).toBe(
      7,
    );
    expect(r.spans).toEqual(['ws subscribe']);
  });
});

describe('ObservabilityStatusService', () => {
  const admin: Actor = { kind: 'account', id: 'a', instanceRole: 'admin' };
  const user: Actor = { kind: 'account', id: 'u', instanceRole: 'user' };
  const service = new ObservabilityStatusService({
    settings: parseTelemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://lgtm:4318' }).settings,
    running: () => true,
  });

  it('answers instance admins only', () => {
    expect(service.status(admin)).toMatchObject({ enabled: true, otlp: { endpoint: 'lgtm:4318' } });
    expect(() => service.status(user)).toThrow(ForbiddenError);
    expect(() => service.status(null)).toThrow(UnauthenticatedError);
  });
});
