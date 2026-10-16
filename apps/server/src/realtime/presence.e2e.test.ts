import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { MapDto, MeDto, PresenceSettingsDto, ServerMessage } from '@darkbeacon/shared';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { parseEnv } from '../config/config.js';

type PresenceMessage = Extract<ServerMessage, { op: 'presence' }>;

describeEachDialect('presence over /ws', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', PUBLIC_URL: 'http://dbk.test', DEMO_MODE: 'true' }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
  });

  const signIn = async (name: string) => {
    const response = await fetch(`http://${base}/api/auth/dev`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, character: { name: `${name} Main` } }),
    });
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split('; ')[0])
      .join('; ');
    const me = (await response.json()) as MeDto;
    const call = async <T>(method: string, path: string, json?: unknown): Promise<T> => {
      const r = await fetch(`http://${base}${path}`, {
        method,
        headers: { cookie, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
      expect(r.status, `${method} ${path}`).toBeLessThan(300);
      return (await r.json()) as T;
    };
    await call('PUT', '/api/accounts/me/main-character', { characterId: me.characters[0]!.id });
    return { me, cookie, call };
  };

  const open = async (cookie: string, stream: string) => {
    const socket = new WebSocket(`ws://${base}/ws`, { headers: { cookie } });
    sockets.push(socket);
    const messages: ServerMessage[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify({ op: 'subscribe', stream }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));
    const presence = () => messages.filter((m): m is PresenceMessage => m.op === 'presence');
    const send = (state: unknown) => socket.send(JSON.stringify({ op: 'presence', stream, state }));
    return { socket, messages, presence, send };
  };

  it('two people on one map see each other, their cursors and what they edit', async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    const map = await alice.call<MapDto>('POST', '/api/maps', { name: 'Chain' });
    await alice.call('POST', `/api/maps/${map.id}/access-rules`, {
      subjectKind: 'account',
      subjectId: bob.me.account.id,
      role: 'viewer',
    });
    expect(await bob.call<PresenceSettingsDto>('GET', '/api/accounts/me/presence')).toEqual({
      shareCursor: true,
      showOthers: true,
    });

    const stream = `map:${map.id}`;
    const a = await open(alice.cookie, stream);
    const b = await open(bob.cookie, stream);
    a.send({});
    // Alice is in the room before Bob joins, so Bob's first list has her (no race between joins).
    await vi.waitFor(() => expect(a.presence().length).toBeGreaterThan(0));
    b.send({
      cursor: { x: 100, y: 50 },
      editing: { kind: 'system', id: '31000005', field: 'status' },
      activity: { verb: 'editing', target: { kind: 'system', id: '31000005' }, label: 'J014348' },
    });

    await vi.waitFor(() =>
      expect(b.presence()[0]).toMatchObject({
        full: true,
        peers: [{ name: 'alice', characterName: 'alice Main' }],
      }),
    );
    await vi.waitFor(() =>
      expect(a.presence().flatMap((p) => p.peers)).toContainEqual(
        expect.objectContaining({
          name: 'bob',
          characterName: 'bob Main',
          cursor: { x: 100, y: 50 },
          activity: { verb: 'editing', target: { kind: 'system', id: '31000005' }, label: 'J014348' },
          editing: { kind: 'system', id: '31000005', field: 'status' },
        }),
      ),
    );

    // Bob stops sharing his cursor (a setting kept on the server): Alice's view follows at once.
    expect(
      await bob.call<PresenceSettingsDto>('PUT', '/api/accounts/me/presence', { shareCursor: false }),
    ).toEqual({
      shareCursor: false,
      showOthers: true,
    });
    await vi.waitFor(() =>
      expect(a.presence().at(-1)!.peers).toContainEqual(
        expect.objectContaining({ name: 'bob', cursor: null }),
      ),
    );

    // Bob closes his tab: Alice sees him leave. Nothing about presence reached the event log.
    const bobKey = a
      .presence()
      .flatMap((p) => p.peers)
      .find((p) => p.name === 'bob')!.key;
    b.socket.close();
    await vi.waitFor(() => expect(a.presence().some((p) => p.left.includes(bobKey))).toBe(true));
    const types = await t.db
      .db<{ event_log: { type: string } }>()
      .selectFrom('event_log')
      .select('type')
      .execute();
    expect(types.some((r) => r.type.startsWith('presence'))).toBe(false);
  });
});
