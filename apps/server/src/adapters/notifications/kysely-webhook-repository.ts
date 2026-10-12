import { bool, json, type Database } from '@darkbeacon/db';
import type { Webhook, WebhookDelivery, WebhookRepository } from '@darkbeacon/notifications';
import type { SecretBox } from './secret-box.js';

export interface WebhookTables {
  webhook: {
    id: string;
    map_id: string;
    url: string;
    events: string;
    secret: string;
    enabled: number;
    created_at: number;
  };
  webhook_delivery: {
    id: string;
    webhook_id: string;
    event_id: string;
    event_type: string;
    payload: string;
    attempt: number;
    status: string;
    response_code: number | null;
    error: string | null;
    next_attempt_at: number | null;
    created_at: number;
  };
}

type WebhookRow = WebhookTables['webhook'];
type DeliveryRow = WebhookTables['webhook_delivery'];

export class KyselyWebhookRepository implements WebhookRepository {
  constructor(
    private readonly database: Database,
    private readonly secrets: SecretBox,
  ) {}

  private get db() {
    return this.database.db<WebhookTables>();
  }

  async listForMap(mapId: string): Promise<Webhook[]> {
    const rows = await this.db
      .selectFrom('webhook')
      .selectAll()
      .where('map_id', '=', mapId)
      .orderBy('created_at')
      .execute();
    return rows.map((r) => this.fromRow(r));
  }

  async findById(id: string): Promise<Webhook | null> {
    const row = await this.db.selectFrom('webhook').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? this.fromRow(row) : null;
  }

  async insert(webhook: Webhook): Promise<void> {
    await this.db.insertInto('webhook').values(this.toRow(webhook)).execute();
  }

  async update(webhook: Webhook): Promise<void> {
    await this.db.updateTable('webhook').set(this.toRow(webhook)).where('id', '=', webhook.id).execute();
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(async () => {
      await this.db.deleteFrom('webhook_delivery').where('webhook_id', '=', id).execute();
      await this.db.deleteFrom('webhook').where('id', '=', id).execute();
    });
  }

  async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    const row = toDeliveryRow(delivery);
    await this.db
      .insertInto('webhook_delivery')
      .values(row)
      .onConflict((oc) => oc.column('id').doUpdateSet(row))
      .execute();
  }

  async listDeliveries(webhookId: string, limit: number): Promise<WebhookDelivery[]> {
    const rows = await this.db
      .selectFrom('webhook_delivery')
      .selectAll()
      .where('webhook_id', '=', webhookId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(fromDeliveryRow);
  }

  async dueDeliveries(now: number, limit: number): Promise<WebhookDelivery[]> {
    const rows = await this.db
      .selectFrom('webhook_delivery')
      .selectAll()
      .where('status', '=', 'pending')
      .where('next_attempt_at', '<=', now)
      .orderBy('next_attempt_at')
      .limit(limit)
      .execute();
    return rows.map(fromDeliveryRow);
  }

  async pruneDeliveries(before: number): Promise<number> {
    const result = await this.db
      .deleteFrom('webhook_delivery')
      .where('status', '!=', 'pending')
      .where('created_at', '<', before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  private toRow(w: Webhook): WebhookRow {
    return {
      id: w.id,
      map_id: w.mapId,
      url: w.url,
      events: json.encode(w.events),
      secret: this.secrets.seal(w.secret),
      enabled: bool.encode(w.enabled),
      created_at: w.createdAt,
    };
  }

  private fromRow(r: WebhookRow): Webhook {
    return {
      id: r.id,
      mapId: r.map_id,
      url: r.url,
      events: json.decode<string[]>(r.events) ?? [],
      secret: this.secrets.open(r.secret),
      enabled: bool.decode(r.enabled),
      createdAt: Number(r.created_at),
    };
  }
}

function toDeliveryRow(d: WebhookDelivery): DeliveryRow {
  return {
    id: d.id,
    webhook_id: d.webhookId,
    event_id: d.eventId,
    event_type: d.eventType,
    payload: d.payload,
    attempt: d.attempt,
    status: d.status,
    response_code: d.responseCode,
    error: d.error,
    next_attempt_at: d.nextAttemptAt,
    created_at: d.createdAt,
  };
}

function fromDeliveryRow(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    webhookId: r.webhook_id,
    eventId: r.event_id,
    eventType: r.event_type,
    payload: r.payload,
    attempt: Number(r.attempt),
    status: r.status as WebhookDelivery['status'],
    responseCode: r.response_code === null ? null : Number(r.response_code),
    error: r.error,
    nextAttemptAt: r.next_attempt_at === null ? null : Number(r.next_attempt_at),
    createdAt: Number(r.created_at),
  };
}
