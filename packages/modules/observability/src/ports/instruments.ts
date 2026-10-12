/** Attribute values of a measurement or span. Keep them low-cardinality (no ids). */
export type TelemetryAttributes = Readonly<Record<string, string | number | boolean>>;

export interface InstrumentOptions {
  description: string;
  /** UCUM unit (`s`, `By`) or an annotation in braces (`{event}`). */
  unit?: string;
}

export interface HistogramOptions extends InstrumentOptions {
  /** Bucket boundaries, in the instrument's unit. */
  boundaries?: readonly number[];
}

export interface Counter {
  add(value: number, attributes?: TelemetryAttributes): void;
}

export interface Recorder {
  record(value: number, attributes?: TelemetryAttributes): void;
}

/** Reports one gauge reading during a collection. */
export type GaugeReport<K extends string> = (
  gauge: K,
  value: number,
  attributes?: TelemetryAttributes,
) => void;

/** Creates metric instruments; implemented over a metrics SDK by an adapter. */
export interface MetricInstruments {
  counter(name: string, options: InstrumentOptions): Counter;
  upDownCounter(name: string, options: InstrumentOptions): Counter;
  histogram(name: string, options: HistogramOptions): Recorder;
  /** A gauge set at the moment something is learnt (the last value wins). */
  gauge(name: string, options: InstrumentOptions): Recorder;
  /**
   * Gauges read when metrics are collected: `read` runs once per collection and reports every
   * gauge in it. Returns a function that stops observing.
   */
  observe<K extends string>(
    gauges: Readonly<Record<K, InstrumentOptions & { name: string }>>,
    read: (report: GaugeReport<K>) => Promise<void>,
  ): () => void;
}

/** Wraps work in a trace span; implemented over a tracing SDK by an adapter. */
export interface SpanTracer {
  span<T>(name: string, attributes: TelemetryAttributes, work: () => Promise<T>): Promise<T>;
}
