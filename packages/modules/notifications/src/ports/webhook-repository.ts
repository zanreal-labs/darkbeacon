import type { Webhook, WebhookDelivery } from '../domain/notification.js';

export interface WebhookRepository {
  listForMap(mapId: string): Promise<Webhook[]>;
  findById(id: string): Promise<Webhook | null>;
  insert(webhook: Webhook): Promise<void>;
  update(webhook: Webhook): Promise<void>;
  delete(id: string): Promise<void>;
  recordDelivery(delivery: WebhookDelivery): Promise<void>;
  listDeliveries(webhookId: string, limit: number): Promise<WebhookDelivery[]>;
  dueDeliveries(now: number, limit: number): Promise<WebhookDelivery[]>;
}

/** Signs and POSTs a payload; resolves with the HTTP status. */
export interface WebhookSender {
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }>;
}
