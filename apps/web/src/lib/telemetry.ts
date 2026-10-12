import {
  routes,
  TELEMETRY_MAX_BATCH,
  TELEMETRY_WEB_EVENTS,
  type TelemetryWebEventName,
  type TelemetryWebEventProps,
} from '@darkbeacon/shared';

/**
 * Anonymous usage events from the browser (docs/telemetry.md). They only ever go to this
 * instance's own server (`POST /api/telemetry/e`), which checks them against the same
 * allow-list and forwards them without anything about the browser; no third-party script, no
 * cookie, no storage. Nothing is queued for long: until the server says telemetry is on, at
 * most a handful of events wait, and they are dropped when it is off.
 */

type Pending = { event: TelemetryWebEventName; props: Record<string, unknown> };

let state: 'unknown' | 'on' | 'off' = 'unknown';
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

const WAITING_MAX = 20;
const FLUSH_MS = 5_000;

/** The browser asks not to be tracked (Do Not Track or Global Privacy Control). */
export function browserOptedOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function send(batch: Pending[], beacon: boolean): void {
  const body = JSON.stringify({ events: batch });
  if (beacon && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(routes.telemetry.ingest.path, new Blob([body], { type: 'application/json' }));
    return;
  }
  void fetch(routes.telemetry.ingest.path, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body,
  }).catch(() => {});
}

/** Sends what is waiting (on page hide through `sendBeacon`, so it survives navigation). */
export function flushTelemetry(beacon = false): void {
  clearTimeout(timer);
  timer = undefined;
  if (state !== 'on') return;
  while (queue.length > 0) send(queue.splice(0, TELEMETRY_MAX_BATCH), beacon);
}

function schedule(): void {
  if (state !== 'on' || timer !== undefined) return;
  timer = setTimeout(() => flushTelemetry(), FLUSH_MS);
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTelemetry(true);
    });
  }
}

/** Whether the server reports usage (it knows the opt-outs); called once the answer is in. */
export function configureTelemetry(active: boolean): void {
  state = active && !browserOptedOut() ? 'on' : 'off';
  if (state === 'off') queue = [];
  else if (queue.length > 0) schedule();
}

/**
 * Reports that a feature was used. Only events and enum values of the shared catalogue are
 * accepted; anything else is dropped here (and refused by the server).
 */
export function track<E extends TelemetryWebEventName>(event: E, props: TelemetryWebEventProps<E>): void {
  if (typeof window === 'undefined' || state === 'off') return;
  const schema = Object.hasOwn(TELEMETRY_WEB_EVENTS, event) ? TELEMETRY_WEB_EVENTS[event] : null;
  const parsed = schema?.safeParse(props);
  if (!parsed?.success) {
    if (process.env.NODE_ENV !== 'production')
      console.warn(`telemetry: ${event} is not on the allow-list`, props);
    return;
  }
  if (state === 'unknown' && queue.length >= WAITING_MAX) return;
  queue.push({ event, props: parsed.data as Record<string, unknown> });
  schedule();
}

/** Test support: back to the state of a fresh page. */
export function resetTelemetry(): void {
  clearTimeout(timer);
  timer = undefined;
  state = 'unknown';
  queue = [];
}
