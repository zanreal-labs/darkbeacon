import type { Clock, DomainEvent, EventLog, NewEvent } from '@darkbeacon/core';
import type {
  InstanceMetrics,
  OutgoingTelemetryEvent,
  TelemetryMetrics,
  TelemetrySink,
  TelemetryStateStore,
} from '../ports/index.js';
import { TelemetryService, type TelemetryConfig, type TelemetryDeps } from './telemetry.js';

export class MemorySink implements TelemetrySink {
  readonly captured: OutgoingTelemetryEvent[] = [];
  flushes = 0;
  capture(event: OutgoingTelemetryEvent): void {
    this.captured.push(event);
  }
  flush(): Promise<void> {
    this.flushes++;
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return this.flush();
  }
}

export class MemoryState implements TelemetryStateStore {
  enabled: boolean | null = null;
  last: number | null = null;
  readonly dismissed = new Set<string>();
  identity() {
    return Promise.resolve({ instanceId: '0190a6f2-7f6e-7c2a-9a51-5d6a0b9e1c11', secret: 'test-secret' });
  }
  adminEnabled() {
    return Promise.resolve(this.enabled);
  }
  setAdminEnabled(enabled: boolean) {
    this.enabled = enabled;
    return Promise.resolve();
  }
  lastHeartbeatAt() {
    return Promise.resolve(this.last);
  }
  setLastHeartbeatAt(at: number) {
    this.last = at;
    return Promise.resolve();
  }
  noticeDismissed(accountId: string) {
    return Promise.resolve(this.dismissed.has(accountId));
  }
  dismissNotice(accountId: string) {
    this.dismissed.add(accountId);
    return Promise.resolve();
  }
}

export const SAMPLE_METRICS: InstanceMetrics = {
  db: 'sqlite',
  login_method: 'eve',
  discord_bot: false,
  plugins_first_party: ['discord-notify'],
  plugins_third_party: '0',
  theme_default: 'system',
  themes_third_party: '0',
  event_retention: false,
  accounts: 12,
  characters: 30,
  maps: 2,
  accounts_dau: 3,
  accounts_wau: 7,
  accounts_mau: 10,
  characters_dau: 4,
  characters_wau: 9,
  characters_mau: 20,
  systems: '26-50',
  connections: '11-25',
  signatures: '51-100',
  webhooks: '1',
  discord_notify_maps: '1',
};

export class FixedMetrics implements TelemetryMetrics {
  online = 5;
  collect() {
    return Promise.resolve(SAMPLE_METRICS);
  }
  onlineTrackedCharacters() {
    return Promise.resolve(this.online);
  }
}

export class RecordingLog implements Pick<EventLog, 'append'> {
  readonly appended: NewEvent[] = [];
  append(events: readonly NewEvent[]): Promise<DomainEvent[]> {
    this.appended.push(...events);
    return Promise.resolve([]);
  }
}

export class ManualClock implements Clock {
  constructor(public time = Date.UTC(2026, 9, 12, 12, 0, 0)) {}
  now() {
    return this.time;
  }
}

/** Not a real HMAC (modules have no crypto); the server's adapter test checks the real one. */
export const fakeHmac = (secret: string, data: string) =>
  [...`${secret}|${data}`]
    .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(32, '0');

export const PRODUCTION: TelemetryConfig = {
  environment: { key: 'phc_test', env: 'production', optOut: null },
  host: 'http://telemetry.test',
  appVersion: '0.1.0',
  demo: false,
  nodeMajor: 24,
  discordLogin: false,
  eveSso: true,
};

export async function service(overrides: Partial<TelemetryDeps> = {}) {
  const sink = new MemorySink();
  const state = new MemoryState();
  const metrics = new FixedMetrics();
  const log = new RecordingLog();
  const clock = new ManualClock();
  const deps: TelemetryDeps = {
    sink,
    state,
    metrics,
    events: log as unknown as EventLog,
    clock,
    hmac: fakeHmac,
    config: PRODUCTION,
    ...overrides,
  };
  const telemetry = new TelemetryService(deps);
  await telemetry.start();
  return { telemetry, sink: deps.sink as MemorySink, state: deps.state as MemoryState, metrics, log, clock };
}
