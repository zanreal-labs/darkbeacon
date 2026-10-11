import type { DomainEvent } from '@wormwright/core';

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

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  attempt: number;
  status: 'pending' | 'delivered' | 'failed';
  responseCode: number | null;
  error: string | null;
  nextAttemptAt: number | null;
  createdAt: number;
}
