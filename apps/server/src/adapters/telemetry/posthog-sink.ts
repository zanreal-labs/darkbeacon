import { createHmac } from 'node:crypto';
import { PostHog } from 'posthog-node';
import type { Clock } from '@darkbeacon/core';
import type { HmacSha256, OutgoingTelemetryEvent, TelemetrySink } from '@darkbeacon/telemetry';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const hmacSha256: HmacSha256 = (secret, data) =>
  createHmac('sha256', secret).update(data).digest('hex');

/** A sink that drops everything: telemetry is inert (no key) or off for good. */
export const inertSink: TelemetrySink = {
  capture: () => {},
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

class BackingOff extends Error {
  override name = 'TelemetryBackingOff';
}

/**
 * Exponential backoff around the ingestion endpoint: after a failure (network, 429, 5xx) no
 * request goes out until the delay has passed, doubling up to `maxMs`. Failures are thrown, so
 * the client keeps its queue and sends it again later; a client error (bad key) is not retried.
 */
export class Backoff {
  private failures = 0;
  private until = 0;

  constructor(
    private readonly clock: Clock,
    private readonly baseMs = 5_000,
    private readonly maxMs = 60 * 60 * 1000,
  ) {}

  get retryAt(): number {
    return this.until;
  }

  wrap(fetch: Fetch): Fetch {
    return async (url, init) => {
      if (this.clock.now() < this.until) throw new BackingOff('backing off after failed sends');
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        this.failed();
        throw error;
      }
      if (response.status === 429 || response.status >= 500) {
        this.failed();
        throw new Error(`telemetry endpoint answered ${response.status}`);
      }
      this.failures = 0;
      this.until = 0;
      return response;
    };
  }

  private failed(): void {
    this.failures++;
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** (this.failures - 1));
    // Jitter, so instances that lost the network together do not come back together.
    this.until = this.clock.now() + delay * (0.75 + Math.random() * 0.5);
  }
}

export interface PostHogSinkOptions {
  key: string;
  host: string;
  fetch: Fetch;
  clock: Clock;
  onError?(error: unknown): void;
  /** Batch size and interval; tests flush sooner. */
  flushAt?: number;
  flushIntervalMs?: number;
}

/** Keys PostHog fills in from the request or the library that must never be sent. */
const STRIPPED = ['$ip', '$geoip_city_name', '$geoip_country_code', '$set', '$set_once', '$session_id'];

/**
 * TelemetrySink over posthog-node: batches (20 events or 30 s), a bounded in-memory queue
 * (1000, oldest dropped), retries through `Backoff`, gzip, flush on shutdown. Every event is
 * anonymous: no person profile, GeoIP off, no IP, nothing but the checked properties.
 */
export class PostHogSink implements TelemetrySink {
  private readonly client: PostHog;

  constructor(options: PostHogSinkOptions) {
    const backoff = new Backoff(options.clock);
    const fetch = backoff.wrap(options.fetch);
    this.client = new PostHog(options.key, {
      host: options.host,
      flushAt: options.flushAt ?? 20,
      flushInterval: options.flushIntervalMs ?? 30_000,
      maxBatchSize: 100,
      maxQueueSize: 1000,
      // Retries are the backoff's job: a failed batch stays queued for the next flush.
      fetchRetryCount: 0,
      requestTimeout: 10_000,
      disableGeoip: true,
      enableExceptionAutocapture: false,
      featureFlagsPollingInterval: null,
      fetch: (url, init) => fetch(url, init as RequestInit) as ReturnType<NonNullable<typeof options.fetch>>,
      before_send: (event) => {
        if (!event) return null;
        const properties = { ...event.properties };
        for (const key of STRIPPED) delete properties[key];
        return {
          ...event,
          properties: { ...properties, $ip: null, $geoip_disable: true, $process_person_profile: false },
        };
      },
    });
    this.client.on('error', (error: unknown) => {
      if (!(error instanceof BackingOff) && !(error instanceof Error && error.cause instanceof BackingOff))
        options.onError?.(error);
    });
  }

  capture(event: OutgoingTelemetryEvent): void {
    this.client.capture({
      distinctId: event.distinctId,
      event: event.event,
      properties: event.properties,
      timestamp: new Date(event.timestamp),
      uuid: event.uuid,
      disableGeoip: true,
    });
  }

  async flush(): Promise<void> {
    await this.client.flush().catch(() => {});
  }

  async shutdown(timeoutMs: number): Promise<void> {
    await this.client.shutdown(timeoutMs).catch(() => {});
  }
}
