import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@wormwright/core';
import {
  WEBHOOK_MAX_ATTEMPTS,
  isDeliverableUrl,
  newWebhookSecret,
  retryDelay,
  signWebhookPayload,
  webhookWants,
  type Webhook,
} from './notification.js';

const webhook: Webhook = {
  id: 'w1',
  mapId: 'm1',
  url: 'https://example.com/hook',
  events: ['system.*', 'connection.added'],
  secret: 's',
  enabled: true,
  createdAt: 0,
};

const event = (type: string, stream = 'map:m1') =>
  ({
    id: 'e',
    seq: 1,
    stream,
    type,
    occurredAt: 0,
    actor: { kind: 'system', id: 't' },
    data: {},
    v: 1,
  }) as DomainEvent;

describe('webhooks', () => {
  it('want their map events of the chosen types while enabled', () => {
    expect(webhookWants(webhook, event('system.added'))).toBe(true);
    expect(webhookWants(webhook, event('connection.added'))).toBe(true);
    expect(webhookWants(webhook, event('connection.removed'))).toBe(false);
    expect(webhookWants(webhook, event('system.added', 'map:other'))).toBe(false);
    expect(webhookWants({ ...webhook, enabled: false }, event('system.added'))).toBe(false);
  });

  it('back off between retries and give up after the last attempt', () => {
    expect(retryDelay(1)).toBe(10_000);
    expect(retryDelay(2)).toBe(60_000);
    expect(retryDelay(WEBHOOK_MAX_ATTEMPTS - 1)).toBe(2 * 60 * 60_000);
    expect(retryDelay(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
  });

  it('sign timestamp and body with HMAC-SHA256', async () => {
    const signature = await signWebhookPayload('secret', 1000, '{"a":1}');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await signWebhookPayload('secret', 1000, '{"a":1}')).toBe(signature);
    expect(await signWebhookPayload('secret', 1001, '{"a":1}')).not.toBe(signature);
    expect(await signWebhookPayload('other', 1000, '{"a":1}')).not.toBe(signature);
  });

  it('only deliver to http(s) and get random secrets', () => {
    expect(isDeliverableUrl('https://example.com')).toBe(true);
    expect(isDeliverableUrl('http://10.0.0.1:8080/x')).toBe(true);
    expect(isDeliverableUrl('file:///etc/passwd')).toBe(false);
    expect(isDeliverableUrl('nope')).toBe(false);
    expect(newWebhookSecret()).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(newWebhookSecret()).not.toBe(newWebhookSecret());
  });
});
