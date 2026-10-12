import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, newEvent, type Actor, type DomainEvent, type MapAccess } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  WEBHOOK_HEADERS,
  WEBHOOK_MAX_ATTEMPTS,
  WebhookAdmin,
  WebhookDispatcher,
  type WebhookSender,
} from '@darkbeacon/notifications';
import { HttpWebhookSender, isPublicAddress } from './http-webhook-sender.js';
import { KyselyWebhookRepository, type WebhookTables } from './kysely-webhook-repository.js';
import { SecretBox } from './secret-box.js';

const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
const bob: Actor = { kind: 'account', id: 'bob', instanceRole: 'user' };
/** alice administers map m1; bob only views it. */
const access: MapAccess = {
  roleOf: async (actor, mapId) => (mapId !== 'm1' ? null : actor.id === 'alice' ? 'admin' : 'viewer'),
  mapsFor: async () => [],
};

class FakeSender implements WebhookSender {
  readonly calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  responses: Array<number | Error> = [];

  async post(url: string, body: string, headers: Record<string, string>) {
    this.calls.push({ url, body, headers });
    const next = this.responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return { status: next };
  }
}

const mapEvent = (type: string, mapId = 'm1'): DomainEvent => ({
  ...newEvent({
    stream: `map:${mapId}`,
    type,
    actor: { kind: 'system', id: 't' },
    data: { n: 1 },
    occurredAt: 5,
  }),
  seq: 1,
  v: 1,
});

describeEachDialect('webhooks', (t) => {
  let sender: FakeSender;
  let clock: ManualClock;
  let repo: KyselyWebhookRepository;
  let dispatcher: WebhookDispatcher;
  let admin: WebhookAdmin;

  beforeEach(() => {
    sender = new FakeSender();
    clock = new ManualClock();
    repo = new KyselyWebhookRepository(t.db, new SecretBox('k'.repeat(32), 'webhook-secret'));
    dispatcher = new WebhookDispatcher({ webhooks: repo, sender, clock });
    admin = new WebhookAdmin({ webhooks: repo, access, dispatcher, clock });
  });

  it('are managed by map admins only, with the secret shown once and stored sealed', async () => {
    const created = await admin.create(alice, 'm1', { url: 'https://example.com/a', events: ['system.*'] });
    expect(created.secret).toMatch(/^whsec_/);
    const row = await t.db.db<WebhookTables>().selectFrom('webhook').selectAll().executeTakeFirstOrThrow();
    expect(row.secret).not.toContain(created.secret);
    expect(await admin.list(alice, 'm1')).toEqual([
      expect.not.objectContaining({ secret: expect.anything() }),
    ]);

    await expect(admin.list(bob, 'm1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(admin.list(alice, 'm2')).rejects.toMatchObject({ code: 'not_found' });
    await expect(admin.create(alice, 'm1', { url: 'ftp://x.example', events: ['*'] })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(admin.create(alice, 'm1', { url: 'https://x.example', events: ['nope.*'] })).rejects.toThrow(
      'Unknown event types',
    );

    const updated = await admin.update(alice, 'm1', created.id, { enabled: false, events: ['ping.created'] });
    expect(updated).toMatchObject({ enabled: false, events: ['ping.created'] });
    await admin.remove(alice, 'm1', created.id);
    expect(await admin.list(alice, 'm1')).toEqual([]);
    await expect(admin.remove(alice, 'm1', created.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deliver matching events with a verifiable signature', async () => {
    const { id, secret } = await admin.create(alice, 'm1', {
      url: 'https://example.com/a',
      events: ['system.added'],
    });
    await dispatcher.handle(mapEvent('system.added'));
    await dispatcher.handle(mapEvent('connection.added'));
    await dispatcher.handle(mapEvent('system.added', 'm2'));

    expect(sender.calls).toHaveLength(1);
    const [call] = sender.calls;
    const timestamp = call!.headers[WEBHOOK_HEADERS.timestamp]!;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${call!.body}`).digest('hex');
    expect(call!.headers[WEBHOOK_HEADERS.signature]).toBe(`sha256=${expected}`);
    expect(call!.headers[WEBHOOK_HEADERS.event]).toBe('system.added');
    expect(JSON.parse(call!.body)).toMatchObject({ type: 'system.added', stream: 'map:m1', data: { n: 1 } });

    expect(await admin.deliveries(alice, 'm1', id)).toEqual([
      expect.objectContaining({
        status: 'delivered',
        attempt: 1,
        responseCode: 200,
        eventType: 'system.added',
      }),
    ]);
  });

  it('retry failures with backoff and give up after the last attempt', async () => {
    const { id } = await admin.create(alice, 'm1', { url: 'https://example.com/a', events: ['*'] });
    sender.responses = [500, new Error('ECONNREFUSED'), 200];
    await dispatcher.handle(mapEvent('system.added'));

    let [delivery] = await admin.deliveries(alice, 'm1', id);
    expect(delivery).toMatchObject({ status: 'pending', attempt: 1, responseCode: 500, error: 'HTTP 500' });
    expect(await dispatcher.retryDue()).toBe(0);

    clock.advance(10_000);
    expect(await dispatcher.retryDue()).toBe(1);
    [delivery] = await admin.deliveries(alice, 'm1', id);
    expect(delivery).toMatchObject({
      status: 'pending',
      attempt: 2,
      responseCode: null,
      error: 'ECONNREFUSED',
    });

    clock.advance(59_999);
    expect(await dispatcher.retryDue()).toBe(0);
    clock.advance(1);
    await dispatcher.retryDue();
    [delivery] = await admin.deliveries(alice, 'm1', id);
    expect(delivery).toMatchObject({ status: 'delivered', attempt: 3, error: null });
    // The same signed body every time.
    expect(new Set(sender.calls.map((c) => c.body)).size).toBe(1);

    sender.responses = Array(10).fill(503);
    await dispatcher.handle(mapEvent('ping.created'));
    for (let i = 0; i < 10; i++) {
      clock.advance(3 * 60 * 60_000);
      await dispatcher.retryDue();
    }
    const [latest] = await admin.deliveries(alice, 'm1', id);
    expect(latest).toMatchObject({ status: 'failed', attempt: WEBHOOK_MAX_ATTEMPTS, responseCode: 503 });
  });

  it('test-send once without retrying, even when disabled', async () => {
    const { id } = await admin.create(alice, 'm1', { url: 'https://example.com/a', events: ['*'] });
    await admin.update(alice, 'm1', id, { enabled: false });
    sender.responses = [404];
    expect(await admin.test(alice, 'm1', id)).toMatchObject({
      status: 'failed',
      attempt: 1,
      responseCode: 404,
      eventType: 'webhook.test',
    });
    await expect(admin.test(bob, 'm1', id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('stop retrying once the webhook is disabled and prune old finished deliveries', async () => {
    const { id } = await admin.create(alice, 'm1', { url: 'https://example.com/a', events: ['*'] });
    sender.responses = [500];
    await dispatcher.handle(mapEvent('system.added'));
    await admin.update(alice, 'm1', id, { enabled: false });
    clock.advance(10_000);
    await dispatcher.retryDue();
    expect(await admin.deliveries(alice, 'm1', id)).toEqual([
      expect.objectContaining({ status: 'failed', error: 'Webhook disabled' }),
    ]);
    expect(await repo.pruneDeliveries(clock.now() + 1)).toBe(1);
  });
});

describe('HttpWebhookSender', () => {
  it('posts the body with headers and reports the status', async () => {
    const received: Array<{ body: string; signature: string | undefined }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        received.push({ body, signature: req.headers[WEBHOOK_HEADERS.signature] as string | undefined });
        res.writeHead(req.url === '/fail' ? 500 : 204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const sender = new HttpWebhookSender({ allowPrivate: async () => true });
      expect(
        await sender.post(`${base}/ok`, '{"x":1}', { [WEBHOOK_HEADERS.signature]: 'sha256=ab' }),
      ).toEqual({
        status: 204,
      });
      expect(await sender.post(`${base}/fail`, '{}', {})).toEqual({ status: 500 });
      expect(received[0]).toEqual({ body: '{"x":1}', signature: 'sha256=ab' });
      await expect(sender.post('http://127.0.0.1:1/', '{}', {})).rejects.toThrow();
    } finally {
      server.close();
    }
  });

  it('refuses private and local targets unless the admin allows them', async () => {
    const sender = new HttpWebhookSender();
    for (const url of [
      'http://127.0.0.1:1/',
      'http://localhost:1/',
      'http://[::1]:1/',
      'http://[::ffff:127.0.0.1]:1/',
      'http://169.254.169.254/latest/meta-data',
      'http://10.1.2.3/',
      'http://0.0.0.0/',
    ]) {
      await expect(sender.post(url, '{}', {}), url).rejects.toThrow(/private or local address/);
    }
  });

  it('tells public addresses from private ones', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
      expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.5.4',
      '192.168.1.1',
      '100.64.0.1',
      '169.254.169.254',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:10.0.0.1',
      'fd00::1',
      'fe80::1',
      'ff02::1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});
