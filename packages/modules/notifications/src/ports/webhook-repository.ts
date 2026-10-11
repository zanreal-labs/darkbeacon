import type { Webhook, WebhookDelivery } from '../domain/notification.js';

export interface WebhookRepository {
  listForMap(mapId: string): Promise<Webhook[]>;
  findById(id: string): Promise<Webhook | null>;
  insert(webhook: Webhook): Promise<void>;
  update(webhook: Webhook): Promise<void>;
  /** Deletes the webhook and its delivery log. */
  delete(id: string): Promise<void>;
  /** Inserts or replaces a delivery. */
  saveDelivery(delivery: WebhookDelivery): Promise<void>;
  /** Newest first. */
  listDeliveries(webhookId: string, limit: number): Promise<WebhookDelivery[]>;
  /** Pending deliveries whose next attempt is due, oldest first. */
  dueDeliveries(now: number, limit: number): Promise<WebhookDelivery[]>;
  /** Deletes finished deliveries created before `before`. Returns the number removed. */
  pruneDeliveries(before: number): Promise<number>;
}

/** POSTs a webhook body; resolves with the HTTP status and rejects on network errors or timeouts. */
export interface WebhookSender {
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }>;
}
