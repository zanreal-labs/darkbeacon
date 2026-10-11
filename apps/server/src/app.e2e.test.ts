import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newEvent, type EventLog } from '@wormwright/core';
import { describeEachDialect } from '@wormwright/db/testing';
import type { ServerMessage } from '@wormwright/shared';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { parseEnv } from './config/config.js';
import { ActorResolverRegistry } from './platform/actor.js';
import { EVENT_LOG } from './platform/tokens.js';

describeEachDialect('server', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  beforeEach(async () => {
    const config = { ...parseEnv({ NODE_ENV: 'test' }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false, webDist: '/nonexistent' });
    // Stand-in for the identity module: a bearer header names the account.
    app
      .get(ActorResolverRegistry)
      .use(async (req) =>
        req.headers.authorization === 'Bearer alice'
          ? { kind: 'account', id: 'alice', instanceRole: 'user' }
          : null,
      );
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the health check and JSON 404s', async () => {
    const health = await fetch(`http://${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', database: t.dialect });

    const missing = await fetch(`http://${base}/api/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('streams events over /ws to an authorized subscriber', async () => {
    const socket = new WebSocket(`ws://${base}/ws`, { headers: { authorization: 'Bearer alice' } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));

    socket.send(JSON.stringify({ op: 'subscribe', stream: 'instance', sinceSeq: 0 }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    await app.get<EventLog>(EVENT_LOG).append([
      newEvent({
        stream: 'instance',
        type: 'access.role_changed',
        actor: { kind: 'system', id: 'test' },
        data: { accountId: 'alice', role: 'admin' },
        occurredAt: Date.now(),
      }),
    ]);
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'event')).toBe(true));
    expect(messages.find((m) => m.op === 'event')).toMatchObject({
      event: { seq: 1, stream: 'instance', type: 'access.role_changed' },
    });
    socket.close();
  });

  it('refuses anonymous subscribers', async () => {
    const socket = new WebSocket(`ws://${base}/ws`);
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ op: 'subscribe', stream: 'instance' }));
    await vi.waitFor(() => expect(messages).toEqual([expect.objectContaining({ code: 'unauthenticated' })]));
    socket.close();
  });
});
