import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const WebhookDto = z.object({
  id: Id,
  mapId: Id,
  url: z.url(),
  /** Event types delivered; supports `system.*` style prefixes. */
  events: z.array(z.string().min(1)).min(1),
  enabled: z.boolean(),
  createdAt: Timestamp,
  /** Deliveries that failed for good in a row; ten turn the webhook off. Optional: added later. */
  consecutiveFailures: z.number().int().optional(),
  /** Why the server turned it off, until someone turns it on again. */
  disabledReason: z.string().nullable().optional(),
});
export type WebhookDto = z.infer<typeof WebhookDto>;

export const CreateWebhookRequest = WebhookDto.pick({ url: true, events: true });
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>;

/** The signing secret is shown once, on creation. */
export const CreatedWebhookDto = WebhookDto.extend({ secret: z.string() });
export type CreatedWebhookDto = z.infer<typeof CreatedWebhookDto>;

export const UpdateWebhookRequest = WebhookDto.pick({ url: true, events: true, enabled: true }).partial();
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequest>;

export const WebhookDeliveryDto = z.object({
  id: Id,
  webhookId: Id,
  eventId: Id,
  eventType: z.string(),
  attempt: z.number().int(),
  status: z.enum(['pending', 'delivered', 'failed']),
  responseCode: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: Timestamp,
});
export type WebhookDeliveryDto = z.infer<typeof WebhookDeliveryDto>;
