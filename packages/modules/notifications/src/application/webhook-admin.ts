import {
  AUDIT_STREAM,
  NotFoundError,
  ValidationError,
  actorRef,
  newEvent,
  newId,
  requireMapRole,
  type Actor,
  type EventLog,
  type UnitOfWork,
} from '@darkbeacon/core';
import {
  EVENT_TYPES,
  redactUrl,
  type AuditEventPayloads,
  type CreateWebhookRequest,
  type CreatedWebhookDto,
  type UpdateWebhookRequest,
  type WebhookDeliveryDto,
  type WebhookDto,
} from '@darkbeacon/shared';
import {
  isDeliverableUrl,
  newWebhookSecret,
  type Webhook,
  type WebhookDelivery,
} from '../domain/notification.js';
import type { Clock, MapAccess } from '../ports/index.js';
import type { WebhookRepository } from '../ports/webhook-repository.js';
import type { WebhookDispatcher } from './webhook-dispatcher.js';

export interface WebhookAdminDeps {
  webhooks: WebhookRepository;
  access: MapAccess;
  dispatcher: WebhookDispatcher;
  clock: Clock;
  /** Config changes are recorded on the audit stream (never the map stream: secrets). */
  events: EventLog;
  uow: UnitOfWork;
}

const DELIVERY_LOG_LIMIT = 100;

/** Webhooks of a map; managed by the map's admins. */
export class WebhookAdmin {
  constructor(private readonly deps: WebhookAdminDeps) {}

  async list(actor: Actor | null, mapId: string): Promise<WebhookDto[]> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    return (await this.deps.webhooks.listForMap(mapId)).map(toWebhookDto);
  }

  /**
   * The secret is returned only here; afterwards it is only used to sign. `enabled: false` adds it
   * switched off (imports: the receiver is not set up for this map's secret yet).
   */
  async create(
    actor: Actor | null,
    mapId: string,
    input: CreateWebhookRequest,
    options: { enabled?: boolean } = {},
  ): Promise<CreatedWebhookDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    const author = actor!;
    checkUrl(input.url);
    checkEventTypes(input.events);
    const webhook: Webhook = {
      id: newId(),
      mapId,
      url: input.url,
      events: [...new Set(input.events)],
      secret: newWebhookSecret(),
      enabled: options.enabled ?? true,
      createdAt: this.deps.clock.now(),
    };
    await this.deps.uow.transaction(async () => {
      await this.deps.webhooks.insert(webhook);
      await this.record(author, 'webhook.created', auditDto(webhook));
    });
    return { ...toWebhookDto(webhook), secret: webhook.secret };
  }

  async update(
    actor: Actor | null,
    mapId: string,
    webhookId: string,
    input: UpdateWebhookRequest,
  ): Promise<WebhookDto> {
    const webhook = await this.require(actor, mapId, webhookId);
    if (input.url !== undefined) checkUrl(input.url);
    if (input.events !== undefined) checkEventTypes(input.events);
    const updated: Webhook = {
      ...webhook,
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.events !== undefined ? { events: [...new Set(input.events)] } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      // Turned on again by a person: it starts with a clean slate.
      ...(input.enabled === true && !webhook.enabled ? { consecutiveFailures: 0, disabledReason: null } : {}),
    };
    await this.deps.uow.transaction(async () => {
      await this.deps.webhooks.update(updated);
      await this.record(actor!, 'webhook.updated', auditDto(updated), auditDto(webhook));
    });
    return toWebhookDto(updated);
  }

  /** A new signing secret, shown once; the old one stops working at once. */
  async rotateSecret(actor: Actor | null, mapId: string, webhookId: string): Promise<CreatedWebhookDto> {
    const webhook = await this.require(actor, mapId, webhookId);
    const rotated: Webhook = { ...webhook, secret: newWebhookSecret() };
    await this.deps.uow.transaction(async () => {
      await this.deps.webhooks.update(rotated);
      await this.deps.events.append([
        newEvent({
          stream: AUDIT_STREAM,
          type: 'webhook.secret_rotated',
          actor: actorRef(actor!),
          data: { id: webhook.id, mapId },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
    });
    return { ...toWebhookDto(rotated), secret: rotated.secret };
  }

  async remove(actor: Actor | null, mapId: string, webhookId: string): Promise<void> {
    const webhook = await this.require(actor, mapId, webhookId);
    await this.deps.uow.transaction(async () => {
      await this.deps.webhooks.delete(webhookId);
      await this.record(actor!, 'webhook.removed', { id: webhookId, mapId }, auditDto(webhook));
    });
  }

  private async record<K extends 'webhook.created' | 'webhook.updated' | 'webhook.removed'>(
    actor: Actor,
    type: K,
    data: AuditEventPayloads[K],
    before?: unknown,
  ): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: AUDIT_STREAM,
        type,
        actor: actorRef(actor),
        data,
        occurredAt: this.deps.clock.now(),
        ...(before === undefined ? {} : { before }),
      }),
    ]);
  }

  /** Drops the webhooks (and delivery logs) of a deleted map; a reaction to `map.removed`. */
  async forgetMap(mapId: string): Promise<void> {
    for (const webhook of await this.deps.webhooks.listForMap(mapId))
      await this.deps.webhooks.delete(webhook.id);
  }

  async deliveries(actor: Actor | null, mapId: string, webhookId: string): Promise<WebhookDeliveryDto[]> {
    await this.require(actor, mapId, webhookId);
    return (await this.deps.webhooks.listDeliveries(webhookId, DELIVERY_LOG_LIMIT)).map(toDeliveryDto);
  }

  async test(actor: Actor | null, mapId: string, webhookId: string): Promise<WebhookDeliveryDto> {
    const webhook = await this.require(actor, mapId, webhookId);
    // A disabled webhook is still tested, so it can be checked before switching it on.
    const delivery = await this.deps.dispatcher.test({ ...webhook, enabled: true }, actorRef(actor!));
    return toDeliveryDto(delivery);
  }

  private async require(actor: Actor | null, mapId: string, webhookId: string): Promise<Webhook> {
    await requireMapRole(this.deps.access, actor, mapId, 'admin');
    const webhook = await this.deps.webhooks.findById(webhookId);
    if (webhook?.mapId !== mapId) throw new NotFoundError('Webhook');
    return webhook;
  }
}

function checkUrl(url: string): void {
  if (!isDeliverableUrl(url)) throw new ValidationError('Webhook URLs must use http or https');
}

/** Known event types, `prefix.*` covering at least one of them, or `*`. */
function checkEventTypes(events: readonly string[]): void {
  const known: readonly string[] = EVENT_TYPES;
  const unknown = events.filter(
    (e) =>
      e !== '*' &&
      !known.includes(e) &&
      !(e.endsWith('.*') && known.some((k) => k.startsWith(e.slice(0, -1)))),
  );
  if (unknown.length > 0) throw new ValidationError(`Unknown event types: ${unknown.join(', ')}`);
}

/** The webhook as the audit trail keeps it: the URL without its path (it may hold a token). */
function auditDto(webhook: Webhook): WebhookDto {
  return { ...toWebhookDto(webhook), url: redactUrl(webhook.url) };
}

export function toWebhookDto(webhook: Webhook): WebhookDto {
  return {
    id: webhook.id,
    mapId: webhook.mapId,
    url: webhook.url,
    events: webhook.events,
    enabled: webhook.enabled,
    createdAt: webhook.createdAt,
    consecutiveFailures: webhook.consecutiveFailures ?? 0,
    disabledReason: webhook.disabledReason ?? null,
  };
}

export function toDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
  return {
    id: delivery.id,
    webhookId: delivery.webhookId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    attempt: delivery.attempt,
    status: delivery.status,
    responseCode: delivery.responseCode,
    error: delivery.error,
    createdAt: delivery.createdAt,
  };
}
