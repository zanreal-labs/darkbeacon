import { channelLabel, esiRoute } from '../domain/labels.js';
import type { GaugeSources } from '../ports/gauge-sources.js';
import type {
  Counter,
  MetricInstruments,
  Recorder,
  SpanTracer,
  TelemetryAttributes,
} from '../ports/instruments.js';

/** One HTTP exchange with ESI, as seen by whoever made it. */
export interface EsiExchange {
  url: string;
  method?: string;
  /** Response status; null when no response came (network error, timeout). */
  status: number | null;
  /** From sending the request to the response headers (or the failure). */
  seconds: number;
  /** Response header lookup (case-insensitive), when there was a response. */
  header?: (name: string) => string | null | undefined;
  /** Why no response came, e.g. `UND_ERR_CONNECT_TIMEOUT`. */
  errorType?: string;
}

/** Latency buckets for calls to ESI and for a tracking poll (seconds). */
const LATENCY_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

const integer = (value: string | null | undefined): number | null =>
  value != null && /^\s*\d+\s*$/.test(value) ? Number(value) : null;

/**
 * The instance's own measurements: what happens in the domain (events, deliveries, ESI,
 * tracking, realtime) as metrics with low-cardinality attributes, plus spans around work the
 * framework instrumentations cannot see. Instruments come from a port, so this knows nothing
 * of the SDK behind it.
 */
export class DomainTelemetry {
  private readonly events: Counter;
  private readonly deliveries: Counter;
  private readonly esiRequests: Counter;
  private readonly esiErrors: Counter;
  private readonly esiDuration: Recorder;
  private readonly esiErrorLimit: Recorder;
  private readonly esiRateLimit: Recorder;
  private readonly pollDuration: Recorder;
  private readonly zkillRequests: Counter;
  private readonly intelKills: Counter;

  constructor(private readonly deps: { instruments: MetricInstruments; tracer: SpanTracer }) {
    const m = deps.instruments;
    this.events = m.counter('darkbeacon.events.appended', {
      description: 'Events committed to the event log, by type',
      unit: '{event}',
    });
    this.deliveries = m.counter('darkbeacon.notifications.deliveries', {
      description: 'Notification deliveries (webhooks, Discord), by channel and outcome',
      unit: '{delivery}',
    });
    this.esiRequests = m.counter('darkbeacon.esi.requests', {
      description: 'Requests to ESI, by route template and status class',
      unit: '{request}',
    });
    this.esiErrors = m.counter('darkbeacon.esi.errors', {
      description: 'ESI requests that failed: an error status or no response at all',
      unit: '{request}',
    });
    this.esiDuration = m.histogram('darkbeacon.esi.request.duration', {
      description: 'Time until ESI answered, by route template',
      unit: 's',
      boundaries: LATENCY_BUCKETS,
    });
    this.esiErrorLimit = m.gauge('darkbeacon.esi.error_limit.remaining', {
      description: 'Errors left in the global ESI error window (X-ESI-Error-Limit-Remain)',
      unit: '{error}',
    });
    this.esiRateLimit = m.gauge('darkbeacon.esi.rate_limit.remaining', {
      description: 'Tokens left in the last seen ESI rate-limit bucket, by group (X-Ratelimit-Remaining)',
      unit: '{token}',
    });
    this.pollDuration = m.histogram('darkbeacon.tracking.poll.duration', {
      description: 'Duration of one tracking poll over every tracked character',
      unit: 's',
      boundaries: LATENCY_BUCKETS,
    });
    this.zkillRequests = m.counter('darkbeacon.zkill.requests', {
      description: 'Requests to zKillboard, by endpoint (r2z2 feed, api) and outcome',
      unit: '{request}',
    });
    this.intelKills = m.counter('darkbeacon.intel.kills', {
      description: 'Killmails stored for systems on maps, by source (feed, history)',
      unit: '{killmail}',
    });
  }

  /** One request to zKillboard; `outcome` is a status class, `404`, `403`, `429` or `error`. */
  zkillRequest(endpoint: 'r2z2' | 'api', outcome: string): void {
    this.zkillRequests.add(1, {
      endpoint,
      outcome: /^([1-5]xx|403|404|429|error)$/.test(outcome) ? outcome : 'other',
    });
  }

  intelKillsStored(source: 'feed' | 'history', count: number): void {
    if (count > 0) this.intelKills.add(count, { source });
  }

  /** Committed events (after the transaction, as the event bus delivers them). */
  eventsCommitted(events: readonly { type: string }[]): void {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    for (const [type, count] of counts) this.events.add(count, { 'event.type': type });
  }

  notificationDelivered(channel: string, ok: boolean): void {
    this.deliveries.add(1, { channel: channelLabel(channel), outcome: ok ? 'ok' : 'failed' });
  }

  /** Records one ESI exchange; requests to anything but ESI are ignored. */
  esiExchange(exchange: EsiExchange): void {
    const route = esiRoute(exchange.url);
    if (route === null) return;
    const base: TelemetryAttributes = {
      'esi.route': route,
      'http.request.method': (exchange.method ?? 'GET').toUpperCase(),
    };
    this.esiDuration.record(exchange.seconds, base);
    if (exchange.status === null) {
      this.esiRequests.add(1, { ...base, 'http.response.status_code': 0 });
      this.esiErrors.add(1, { ...base, 'error.type': exchange.errorType ?? 'network' });
      return;
    }
    this.esiRequests.add(1, { ...base, 'http.response.status_code': exchange.status });
    if (exchange.status >= 400) this.esiErrors.add(1, { ...base, 'error.type': String(exchange.status) });
    const header = exchange.header;
    if (!header) return;
    const errorsLeft = integer(header('x-esi-error-limit-remain'));
    if (errorsLeft !== null) this.esiErrorLimit.record(errorsLeft);
    const group = header('x-ratelimit-group');
    const tokensLeft = integer(header('x-ratelimit-remaining'));
    if (group && tokensLeft !== null) this.esiRateLimit.record(tokensLeft, { 'esi.rate_limit.group': group });
  }

  trackingPolled(seconds: number): void {
    this.pollDuration.record(seconds);
  }

  /** Runs `work` in a span (realtime subscriptions and the like, which HTTP tracing does not see). */
  traced<T>(name: string, attributes: TelemetryAttributes, work: () => Promise<T>): Promise<T> {
    return this.deps.tracer.span(name, attributes, work);
  }

  /** Reports the gauges whenever metrics are collected. Returns a function that stops it. */
  observe(sources: GaugeSources): () => void {
    return this.deps.instruments.observe(
      {
        online: {
          name: 'darkbeacon.characters.online',
          description: 'Characters online, over all maps',
          unit: '{character}',
        },
        maps: { name: 'darkbeacon.maps', description: 'Maps on this instance', unit: '{map}' },
        lag: {
          name: 'darkbeacon.event_consumer.lag',
          description: 'Events a durable event-log consumer still has to handle (outbox backlog)',
          unit: '{event}',
        },
        connections: {
          name: 'darkbeacon.realtime.connections',
          description: 'Open realtime WebSocket connections',
          unit: '{connection}',
        },
      },
      async (report) => {
        const [online, maps, lag] = await Promise.all([
          sources.onlineCharacters(),
          sources.maps(),
          sources.consumerLag(),
        ]);
        report('online', online);
        report('maps', maps);
        for (const { consumer, behind } of lag) report('lag', behind, { consumer });
        report('connections', sources.realtimeConnections());
      },
    );
  }
}
