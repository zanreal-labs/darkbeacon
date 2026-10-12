import { describe, expect, it } from 'vitest';
import { trace } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { DomainTelemetry } from '@darkbeacon/observability';
import { OtelInstruments, OtelSpanTracer } from './otel-instruments.js';

class TestReader extends MetricReader {
  protected override async onShutdown(): Promise<void> {}
  protected override async onForceFlush(): Promise<void> {}
}

async function collected(reader: TestReader) {
  const { resourceMetrics } = await reader.collect();
  const byName = new Map<string, DataPoint<unknown>[]>();
  for (const scope of resourceMetrics.scopeMetrics)
    for (const metric of scope.metrics)
      byName.set(metric.descriptor.name, metric.dataPoints as DataPoint<unknown>[]);
  return byName;
}

describe('OtelInstruments', () => {
  it('turns domain measurements into OpenTelemetry metrics', async () => {
    const reader = new TestReader();
    const provider = new MeterProvider({ readers: [reader] });
    const telemetry = new DomainTelemetry({
      instruments: new OtelInstruments(provider.getMeter('darkbeacon')),
      tracer: new OtelSpanTracer(trace.getTracer('test')),
    });

    telemetry.eventsCommitted([{ type: 'system.added' }, { type: 'system.added' }]);
    telemetry.eventsCommitted([{ type: 'system.added' }]);
    telemetry.notificationDelivered('webhook', false);
    telemetry.esiExchange({
      url: 'https://esi.evetech.net/characters/1/location',
      status: 200,
      seconds: 0.2,
    });
    telemetry.trackingPolled(0.3);
    telemetry.observe({
      onlineCharacters: async () => 2,
      maps: async () => 1,
      consumerLag: async () => [{ consumer: 'webhooks', behind: 4 }],
      realtimeConnections: () => 3,
    });

    const metrics = await collected(reader);
    const value = (name: string, attributes: Record<string, unknown> = {}) =>
      metrics.get(name)?.find((p) => Object.entries(attributes).every(([k, v]) => p.attributes[k] === v))
        ?.value;

    expect(value('darkbeacon.events.appended', { 'event.type': 'system.added' })).toBe(3);
    expect(value('darkbeacon.notifications.deliveries', { channel: 'webhook', outcome: 'failed' })).toBe(1);
    expect(value('darkbeacon.esi.requests', { 'esi.route': '/characters/{id}/location' })).toBe(1);
    expect(value('darkbeacon.esi.request.duration')).toMatchObject({ count: 1, sum: 0.2 });
    expect(value('darkbeacon.tracking.poll.duration')).toMatchObject({ count: 1 });
    expect(value('darkbeacon.characters.online')).toBe(2);
    expect(value('darkbeacon.maps')).toBe(1);
    expect(value('darkbeacon.event_consumer.lag', { consumer: 'webhooks' })).toBe(4);
    expect(value('darkbeacon.realtime.connections')).toBe(3);

    // Counters add up across collections.
    telemetry.eventsCommitted([{ type: 'system.added' }]);
    expect(
      (await collected(reader))
        .get('darkbeacon.events.appended')
        ?.find((p) => p.attributes['event.type'] === 'system.added')?.value,
    ).toBe(4);
    await provider.shutdown();
  });
});
