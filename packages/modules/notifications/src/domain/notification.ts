import { matchesFilter, mapStream, type DomainEvent } from '@darkbeacon/core';

export interface Notification {
  mapId: string | null;
  title: string;
  body: string;
  url?: string;
  event?: DomainEvent;
}

export interface Webhook {
  id: string;
  mapId: string;
  url: string;
  /** Event types or `prefix.*`. */
  events: string[];
  /** HMAC-SHA256 key; stored encrypted by the adapter. */
  secret: string;
  enabled: boolean;
  createdAt: number;
}

/** One event to one webhook; `attempt` counts the POSTs made so far. */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  /** The exact JSON body that is signed and sent on every attempt. */
  payload: string;
  attempt: number;
  status: 'pending' | 'delivered' | 'failed';
  responseCode: number | null;
  error: string | null;
  nextAttemptAt: number | null;
  createdAt: number;
}

/** Waits after the 1st, 2nd... failed attempt. One attempt more than delays in total. */
export const WEBHOOK_RETRY_DELAYS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS.length + 1;

/** Delay before the next try after `attempt` failed attempts, or null when it is time to give up. */
export function retryDelay(attempt: number): number | null {
  return WEBHOOK_RETRY_DELAYS[attempt - 1] ?? null;
}

export function webhookWants(webhook: Webhook, event: DomainEvent): boolean {
  return webhook.enabled && matchesFilter(event, { stream: mapStream(webhook.mapId), types: webhook.events });
}

export const WEBHOOK_HEADERS = {
  /** `sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">` */
  signature: 'x-darkbeacon-signature',
  /** Epoch ms of this attempt; receivers should reject old ones. */
  timestamp: 'x-darkbeacon-timestamp',
  event: 'x-darkbeacon-event',
  delivery: 'x-darkbeacon-delivery',
} as const;

/** Signs `<timestamp>.<body>`, so a captured request cannot be replayed later with a new timestamp. */
export async function signWebhookPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return `sha256=${toHex(new Uint8Array(mac))}`;
}

export function newWebhookSecret(): string {
  return `whsec_${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function isDeliverableUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
