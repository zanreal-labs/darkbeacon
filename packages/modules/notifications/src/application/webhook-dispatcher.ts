import {
  AUDIT_STREAM,
  newEvent,
  newId,
  parseStream,
  type DomainEvent,
  type EventLog,
} from '@darkbeacon/core';
import {
  WEBHOOK_HEADERS,
  WEBHOOK_MAX_CONSECUTIVE_FAILURES,
  WEBHOOK_RETRY_DELAYS,
  retryDelay,
  signWebhookPayload,
  webhookWants,
  type Webhook,
  type WebhookDelivery,
} from '../domain/notification.js';
import type { Clock } from '../ports/index.js';
import type { WebhookRepository, WebhookSender } from '../ports/webhook-repository.js';

export interface WebhookDispatcherDeps {
  webhooks: WebhookRepository;
  sender: WebhookSender;
  clock: Clock;
  /** The instance switch for webhooks; absent: always on. */
  enabled?: () => Promise<boolean>;
  /** Where turning a failing webhook off is recorded (the audit stream). */
  events?: EventLog;
}

/**
 * Turns committed map events into webhook deliveries. `queue` stores the deliveries of an event
 * (the server calls it from a durable event-log consumer, in the transaction that moves its
 * cursor) and `send` makes the first attempts; `retryDue` (on a timer) resends failed ones.
 */
export class WebhookDispatcher {
  /** Deliveries being sent right now, so a retry tick never sends one twice. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: WebhookDispatcherDeps) {}

  /** Queues and sends at once. */
  async handle(event: DomainEvent): Promise<void> {
    await this.send(await this.queue(event));
  }

  /** Stores one pending delivery per webhook that wants the event. */
  async queue(event: DomainEvent): Promise<Array<{ delivery: WebhookDelivery; webhook: Webhook }>> {
    const stream = parseStream(event.stream);
    if (stream?.kind !== 'map') return [];
    // Turned off on the instance: nothing is queued, so nothing is sent later either.
    if (!(await this.on())) return [];
    const webhooks = (await this.deps.webhooks.listForMap(stream.id)).filter((w) => webhookWants(w, event));
    const queued = [];
    for (const webhook of webhooks) {
      const delivery = this.newDelivery(webhook, event);
      await this.deps.webhooks.saveDelivery(delivery);
      queued.push({ delivery, webhook });
    }
    return queued;
  }

  /** First attempts of queued deliveries. */
  async send(queued: ReadonlyArray<{ delivery: WebhookDelivery; webhook: Webhook }>): Promise<void> {
    await Promise.all(queued.map(({ delivery, webhook }) => this.attempt(delivery, webhook)));
  }

  /** Sends a synthetic `webhook.test` event once, without retries. */
  async test(webhook: Webhook, actor: DomainEvent['actor']): Promise<WebhookDelivery> {
    const event: DomainEvent = {
      id: newId(),
      seq: 0,
      stream: `map:${webhook.mapId}`,
      type: 'webhook.test',
      occurredAt: this.deps.clock.now(),
      actor,
      data: { webhookId: webhook.id },
      v: 1,
    };
    const delivery = this.newDelivery(webhook, event);
    await this.deps.webhooks.saveDelivery(delivery);
    return this.attempt(delivery, webhook, { retry: false });
  }

  /** Resends due deliveries. Returns how many were attempted. */
  async retryDue(limit = 50): Promise<number> {
    if (!(await this.on())) return 0;
    const due = await this.deps.webhooks.dueDeliveries(this.deps.clock.now(), limit);
    const ready = due.filter((d) => !this.inFlight.has(d.id));
    await Promise.all(ready.map((d) => this.attempt(d)));
    return ready.length;
  }

  private async attempt(
    delivery: WebhookDelivery,
    webhook?: Webhook | null,
    options: { retry: boolean } = { retry: true },
  ): Promise<WebhookDelivery> {
    this.inFlight.add(delivery.id);
    try {
      const target = webhook ?? (await this.deps.webhooks.findById(delivery.webhookId));
      const result = target?.enabled
        ? await this.post(target, delivery)
        : { status: null, error: 'Webhook disabled' };
      const attempt = delivery.attempt + 1;
      const delay = result.error !== null && options.retry && target?.enabled ? retryDelay(attempt) : null;
      const updated: WebhookDelivery = {
        ...delivery,
        attempt,
        responseCode: result.status,
        error: result.error,
        status: result.error === null ? 'delivered' : delay === null ? 'failed' : 'pending',
        nextAttemptAt: delay === null ? null : this.deps.clock.now() + delay,
      };
      await this.deps.webhooks.saveDelivery(updated);
      if (options.retry && target?.enabled) await this.health(target.id, updated);
      return updated;
    } finally {
      this.inFlight.delete(delivery.id);
    }
  }

  private async on(): Promise<boolean> {
    return (await this.deps.enabled?.()) ?? true;
  }

  /**
   * Counts deliveries that failed for good in a row and turns the webhook off after
   * `WEBHOOK_MAX_CONSECUTIVE_FAILURES`; a delivered one resets the count.
   */
  private async health(webhookId: string, delivery: WebhookDelivery): Promise<void> {
    if (delivery.status === 'pending') return;
    const webhook = await this.deps.webhooks.findById(webhookId);
    if (!webhook) return;
    const failures = webhook.consecutiveFailures ?? 0;
    if (delivery.status === 'delivered') {
      if (failures > 0) await this.deps.webhooks.update({ ...webhook, consecutiveFailures: 0 });
      return;
    }
    const count = failures + 1;
    const off = count >= WEBHOOK_MAX_CONSECUTIVE_FAILURES && webhook.enabled;
    await this.deps.webhooks.update({
      ...webhook,
      consecutiveFailures: count,
      ...(off
        ? {
            enabled: false,
            disabledReason: `Turned off after ${count} deliveries failed in a row (last: ${delivery.error ?? 'error'})`,
          }
        : {}),
    });
    if (off && this.deps.events) {
      await this.deps.events.append([
        newEvent({
          stream: AUDIT_STREAM,
          type: 'webhook.auto_disabled',
          actor: { kind: 'system', id: 'webhooks' },
          data: { id: webhook.id, mapId: webhook.mapId, failures: count, lastError: delivery.error },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
    }
  }

  private async post(
    webhook: Webhook,
    delivery: WebhookDelivery,
  ): Promise<{ status: number | null; error: string | null }> {
    const timestamp = this.deps.clock.now();
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'Darkbeacon-Webhooks',
      [WEBHOOK_HEADERS.signature]: await signWebhookPayload(webhook.secret, timestamp, delivery.payload),
      [WEBHOOK_HEADERS.timestamp]: String(timestamp),
      [WEBHOOK_HEADERS.event]: delivery.eventType,
      [WEBHOOK_HEADERS.delivery]: delivery.id,
    };
    try {
      const { status } = await this.deps.sender.post(webhook.url, delivery.payload, headers);
      return { status, error: status >= 200 && status < 300 ? null : `HTTP ${status}` };
    } catch (error) {
      return { status: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private newDelivery(webhook: Webhook, event: DomainEvent): WebhookDelivery {
    const now = this.deps.clock.now();
    return {
      id: newId(),
      webhookId: webhook.id,
      eventId: event.id,
      eventType: event.type,
      payload: JSON.stringify(event),
      attempt: 0,
      status: 'pending',
      responseCode: null,
      error: null,
      // Doubles as a lease: the first attempt starts now, and if the process dies during it
      // the retry timer picks the delivery up later.
      nextAttemptAt: now + WEBHOOK_RETRY_DELAYS[0],
      createdAt: now,
    };
  }
}
