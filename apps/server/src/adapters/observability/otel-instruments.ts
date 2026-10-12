import {
  context,
  SpanStatusCode,
  type Attributes,
  type BatchObservableResult,
  type Meter,
  type Observable,
  type Tracer,
} from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import type {
  GaugeReport,
  InstrumentOptions,
  MetricInstruments,
  SpanTracer,
  TelemetryAttributes,
} from '@darkbeacon/observability';

const options = (o: InstrumentOptions) => ({
  description: o.description,
  ...(o.unit ? { unit: o.unit } : {}),
});

/** MetricInstruments over an OpenTelemetry Meter. */
export class OtelInstruments implements MetricInstruments {
  constructor(private readonly meter: Meter) {}

  counter(name: string, o: InstrumentOptions) {
    const counter = this.meter.createCounter(name, options(o));
    return {
      add: (value: number, attributes?: TelemetryAttributes) => counter.add(value, attributes as Attributes),
    };
  }

  upDownCounter(name: string, o: InstrumentOptions) {
    const counter = this.meter.createUpDownCounter(name, options(o));
    return {
      add: (value: number, attributes?: TelemetryAttributes) => counter.add(value, attributes as Attributes),
    };
  }

  histogram(name: string, o: InstrumentOptions & { boundaries?: readonly number[] }) {
    const histogram = this.meter.createHistogram(name, {
      ...options(o),
      ...(o.boundaries ? { advice: { explicitBucketBoundaries: [...o.boundaries] } } : {}),
    });
    return {
      record: (value: number, attributes?: TelemetryAttributes) =>
        histogram.record(value, attributes as Attributes),
    };
  }

  gauge(name: string, o: InstrumentOptions) {
    const gauge = this.meter.createGauge(name, options(o));
    return {
      record: (value: number, attributes?: TelemetryAttributes) =>
        gauge.record(value, attributes as Attributes),
    };
  }

  observe<K extends string>(
    gauges: Readonly<Record<K, InstrumentOptions & { name: string }>>,
    read: (report: GaugeReport<K>) => Promise<void>,
  ): () => void {
    const instruments = Object.fromEntries(
      Object.entries<InstrumentOptions & { name: string }>(gauges).map(([key, g]) => [
        key,
        this.meter.createObservableGauge(g.name, options(g)),
      ]),
    ) as Record<K, Observable>;
    const callback = async (result: BatchObservableResult) => {
      // The reads (database queries) are not part of anything worth a trace.
      await context.with(suppressTracing(context.active()), async () => {
        try {
          await read((key, value, attributes) =>
            result.observe(instruments[key], value, attributes as Attributes),
          );
        } catch {
          // A failed read (the database closing on shutdown) skips this collection.
        }
      });
    };
    const observables = Object.values<Observable>(instruments);
    this.meter.addBatchObservableCallback(callback, observables);
    return () => this.meter.removeBatchObservableCallback(callback, observables);
  }
}

/** SpanTracer over an OpenTelemetry Tracer: errors mark the span and are rethrown. */
export class OtelSpanTracer implements SpanTracer {
  constructor(private readonly tracer: Tracer) {}

  span<T>(name: string, attributes: TelemetryAttributes, work: () => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, { attributes: attributes as Attributes }, async (span) => {
      try {
        return await work();
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
