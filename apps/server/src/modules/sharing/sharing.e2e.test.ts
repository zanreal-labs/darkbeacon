import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditPageDto,
  ConnectionDto,
  MapDto,
  MapSharingDto,
  MeDto,
  PublicMapViewDto,
  ServerMessage,
  SignatureDto,
} from '@darkbeacon/shared';
import WebSocket from 'ws';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';

const JITA = 30000142;
const PERIMETER = 30000144;

/** What a public view must not show unless its scopes say so. */
const SECRET = {
  note: 'SECRET-NOTE-our-fleet-is-here',
  tag: 'SECRT',
  name: 'SECRET-HOME',
  sigName: 'SECRET-SITE',
  label: 'SECRET-LABEL',
};

describeEachDialect('public maps', (t) => {
  let app: NestFastifyApplication;
  let base: string;

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
    await app.close();
  });

  const signIn = async (name: string) => {
    const browser = new Browser(base);
    await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: `${name} Main` } },
    });
    return browser;
  };

  /** A chain with intel on it: a note, a tag, a custom name, a label, a signature, a dangerous hole. */
  const chain = async (alice: Browser) => {
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Home chain' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/labels`, {
      method: 'PUT',
      json: { labels: [{ id: 'l1', name: SECRET.label, color: '#22aa66', description: '' }] },
    });
    await alice.json(`${m}/systems`, {
      method: 'POST',
      json: { solarSystemId: JITA, position: { x: 0, y: 0 } },
    });
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: PERIMETER } });
    await alice.json(`${m}/systems/${JITA}`, {
      method: 'PATCH',
      json: {
        description: SECRET.note,
        tag: SECRET.tag,
        customName: SECRET.name,
        status: 'home',
        labelIds: ['l1'],
      },
    });
    const connection = await alice.json<ConnectionDto>(`${m}/connections`, {
      method: 'POST',
      json: { source: JITA, target: PERIMETER, type: 'wormhole' },
    });
    await alice.json(`${m}/connections/${connection.id}`, {
      method: 'PATCH',
      json: { massStatus: 'critical', dangerous: true },
    });
    await alice.json<SignatureDto>(`${m}/systems/${JITA}/signatures`, {
      method: 'POST',
      json: { eveId: 'ABC-123', name: SECRET.sigName },
    });
    return { map, m };
  };

  const view = (id: string) => fetch(`http://${base}/api/public/maps/${id}`);
  const leaks = (body: string, allowed: string[] = []) =>
    Object.values(SECRET).filter((s) => !allowed.includes(s) && body.includes(s));

  it('shares a read-only view with safe defaults, and nothing else leaves the server', async () => {
    const alice = await signIn('alice');
    const { map, m } = await chain(alice);

    const before = await alice.json<MapSharingDto>(`${m}/sharing`);
    expect(before).toMatchObject({
      enabled: false,
      token: null,
      scopes: ['topology', 'connectionStatus'],
      noindex: true,
    });

    const shared = await alice.json<MapSharingDto>(`${m}/sharing`, {
      method: 'PATCH',
      json: { enabled: true },
    });
    expect(shared.token).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(shared.url).toBe(`http://dbk.test/p/${shared.token}`);

    const response = await view(shared.token!);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(leaks(body)).toEqual([]);
    expect(body).not.toContain(map.ownerAccountId);
    const dto = JSON.parse(body) as PublicMapViewDto;
    expect(dto.map).toMatchObject({ name: 'Home chain', labels: [] });
    expect(dto.snapshot.systems.map((s) => s.solarSystemId).sort()).toEqual([JITA, PERIMETER]);
    expect(dto.snapshot.connections[0]).toMatchObject({ massStatus: 'critical', dangerous: false });
    expect(dto.snapshot.signatures).toBeUndefined();
    expect(dto.universe.map((u) => u.name).sort()).toEqual(['Jita', 'Perimeter']);

    // The toggle is in the map history; the link itself is not.
    const history = await alice.json<AuditPageDto>(`${m}/history`);
    const entry = history.entries.find((e) => e.type === 'access.sharing_changed')!;
    expect(entry.diff.enabled).toEqual({ before: false, after: true });
    expect(JSON.stringify(history)).not.toContain(shared.token);

    // More scopes show more, and only that.
    await alice.json(`${m}/sharing`, { method: 'PATCH', json: { scopes: ['signatures', 'labels'] } });
    const more = await (await view(shared.token!)).text();
    expect(leaks(more, [SECRET.sigName, SECRET.label])).toEqual([]);
    expect(more).toContain(SECRET.sigName);
  });

  it('is managed by map admins only, regenerates, takes a slug and obeys the instance switch', async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    const { m } = await chain(alice);
    expect((await bob.request(`${m}/sharing`)).status).toBe(404);
    expect((await view('x'.repeat(32))).status).toBe(404);

    const first = await alice.json<MapSharingDto>(`${m}/sharing`, {
      method: 'PATCH',
      json: { enabled: true, slug: 'home-public' },
    });
    expect((await view('home-public')).status).toBe(200);
    const second = await alice.json<MapSharingDto>(`${m}/sharing/regenerate`, { method: 'POST' });
    expect(second.token).not.toBe(first.token);
    expect((await view(first.token!)).status).toBe(404);
    expect((await view(second.token!)).status).toBe(200);

    await alice.json(`${m}/sharing`, { method: 'PATCH', json: { enabled: false } });
    expect((await view(second.token!)).status).toBe(404);
    expect((await view('home-public')).status).toBe(404);

    await alice.json('/api/admin/settings', { method: 'PATCH', json: { publicMaps: false } });
    expect((await alice.request(`${m}/sharing`, { method: 'PATCH', json: { enabled: true } })).status).toBe(
      403,
    );
  });

  it('streams live changes to anonymous viewers, cut down to what the link shares', async () => {
    const alice = await signIn('alice');
    const { m } = await chain(alice);
    const { token } = await alice.json<MapSharingDto>(`${m}/sharing`, {
      method: 'PATCH',
      json: { enabled: true },
    });
    const initial = (await (await view(token!)).json()) as PublicMapViewDto;
    expect(initial.stream).toBe(`public:${token}`);

    // A browser on the public page: no cookie, an Origin of the instance.
    const socket = new WebSocket(`ws://${base}/ws`, { headers: { origin: 'http://dbk.test' } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: initial.stream, sinceSeq: initial.seq }));
    await vi.waitFor(() => expect(messages.some((x) => x.op === 'subscribed')).toBe(true));
    // Anonymous viewers cannot join presence: nothing is sent to others.
    socket.send(
      JSON.stringify({ op: 'presence', stream: initial.stream, state: { cursor: { x: 1, y: 1 } } }),
    );

    await alice.json(`/api/maps/${initial.map.id}/systems/${PERIMETER}`, {
      method: 'PATCH',
      json: { description: SECRET.note, status: 'hostile' },
    });
    await alice.json(`/api/maps/${initial.map.id}/systems/${JITA}/signatures`, {
      method: 'POST',
      json: { eveId: 'XYZ-999', name: SECRET.sigName },
    });
    await alice.json(`/api/maps/${initial.map.id}/systems/${JITA}`, {
      method: 'PATCH',
      json: { position: { x: 50, y: 60 } },
    });

    await vi.waitFor(() =>
      expect(
        messages.filter((x) => x.op === 'event').map((x) => (x.op === 'event' ? x.event.type : '')),
      ).toEqual(['system.updated', 'system.updated']),
    );
    const events = messages.flatMap((x) => (x.op === 'event' ? [x.event] : []));
    expect(events.every((e) => e.stream === initial.stream && e.actor.kind === 'system')).toBe(true);
    expect(leaks(JSON.stringify(messages))).toEqual([]);
    expect(messages.some((x) => x.op === 'presence')).toBe(false);

    // Switching the link off drops the stream.
    await alice.json(`/api/maps/${initial.map.id}/sharing`, { method: 'PATCH', json: { enabled: false } });
    await vi.waitFor(() =>
      expect(messages.some((x) => x.op === 'error' && x.stream === initial.stream)).toBe(true),
    );
    socket.close();
  });
});
