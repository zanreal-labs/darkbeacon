import type { HeartbeatProps } from '../domain/catalogue.js';

export type { Clock, EventLog } from '@darkbeacon/core';

/** One event as it leaves the instance: already checked, stripped and pseudonymous. */
export interface OutgoingTelemetryEvent {
  /** UUID v7; lets the receiver drop duplicates of a retried batch. */
  uuid: string;
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  /** Epoch ms. */
  timestamp: number;
}

/**
 * Where events go (PostHog in production). `capture` queues and returns at once; the sink
 * batches, retries with backoff, and keeps events while the receiver cannot be reached, up to
 * a bounded queue. It never throws into the caller.
 */
export interface TelemetrySink {
  capture(event: OutgoingTelemetryEvent): void;
  /** Sends what is queued now. */
  flush(): Promise<void>;
  /** Flushes and stops, waiting at most `timeoutMs`. */
  shutdown(timeoutMs: number): Promise<void>;
}

/** This instance's telemetry identity and state, kept in its own database. */
export interface TelemetryStateStore {
  /** The random instance id and the HMAC secret for account pseudonyms, created on first use. */
  identity(): Promise<{ instanceId: string; secret: string }>;
  /** The admin switch; null until an admin set it (on). */
  adminEnabled(): Promise<boolean | null>;
  setAdminEnabled(enabled: boolean): Promise<void>;
  lastHeartbeatAt(): Promise<number | null>;
  setLastHeartbeatAt(at: number): Promise<void>;
  noticeDismissed(accountId: string): Promise<boolean>;
  dismissNotice(accountId: string, at: number): Promise<void>;
}

/** What the heartbeat counts that this module does not know itself. */
export type InstanceMetrics = Omit<
  HeartbeatProps,
  'node_major' | 'discord_login' | 'eve_sso' | 'online_peak'
>;

/** Reads the sizes and configuration of the instance (counts only, never contents). */
export interface TelemetryMetrics {
  collect(now: number): Promise<InstanceMetrics>;
  /** Tracked characters online right now (for the daily peak). */
  onlineTrackedCharacters(): Promise<number>;
}
