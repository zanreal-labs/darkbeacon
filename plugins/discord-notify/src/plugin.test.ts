import { afterEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  ConnectionDto,
  DiscordNotifyStateDto,
  DomainEvent,
  DurableConsumer,
  MapSystemDto,
  PluginContext,
  PluginConfigChange,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
  UniverseSystemDto,
} from '@darkbeacon/plugin-sdk';
import { up } from './migrations/0001_init.js';
import { DiscordNotify } from './server.js';

const HOOK = 'https://discord.com/api/webhooks/123/abcdefghijklmnopqrstuvwxyz';
const ALL = {
  connections: true,
  eol: true,
  danger: true,
  kills: true,
  pings: true,
  wayHome: true,
  arrivals: true,
};

const UNIVERSE: Record<number, Partial<UniverseSystemDto>> = {
  31000001: { name: 'J100001', whClass: 3 },
  31000002: { name: 'J100002', whClass: 5 },
  30002537: { name: 'Amamake', whClass: 8 },
};
const universe = (id: number) => (UNIVERSE[id] ? ({ id, ...UNIVERSE[id] } as UniverseSystemDto) : null);

const system = (solarSystemId: number, extra: Partial<MapSystemDto> = {}) =>
  ({
    mapId: 'm1',
    solarSystemId,
    status: 'unknown',
    visible: true,
    customName: null,
    temporaryName: null,
    description: '',
    ...extra,
  }) as MapSystemDto;

const connection = (id: string, source: number, target: number, extra: Partial<ConnectionDto> = {}) =>
  ({
    id,
    mapId: 'm1',
    source,
    target,
    type: 'wormhole',
    timeStatus: 'normal',
    massStatus: 'fresh',
    shipSize: 'large',
    dangerous: false,
    bubbled: 'none',
    ...extra,
  }) as ConnectionDto;

describeEachDialect('discord-notify plugin', (t) => {
  let app: DiscordNotify | null = null;
  afterEach(async () => {
    await app?.stop();
    app = null;
  });

  async function setup() {
    await up(t.db.db());
    let now = Date.UTC(2026, 9, 12, 12, 0);
    const posts: Array<Record<string, unknown>> = [];
    const botPosts: Array<{ channelId: string; body: Record<string, unknown> }> = [];
    let answer = () => new Response(JSON.stringify({ id: 'm' }), { status: 200 });
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url === HOOK && !init?.method)
        return new Response(JSON.stringify({ name: 'Alerts' }), { status: 200 });
      if (url === `${HOOK}?wait=true`) {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return answer();
      }
      if (url.endsWith('/universe/names')) {
        return new Response(JSON.stringify([{ id: 2112000001, name: 'Ayla Vex' }]), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };
    const consumers: DurableConsumer[] = [];
    const routes: PluginRoute[] = [];
    const audits: PluginConfigChange[] = [];
    const deliveries: string[] = [];
    const systems = [system(31000001, { status: 'home' }), system(31000002), system(30002537)];
    const connections = [connection('c1', 31000001, 30002537)];
    const ctx = {
      plugin: { id: 'discord-notify', version: '2.0.0' },
      instance: { publicUrl: 'https://beacon.example' },
      secrets: { seal: (s: string) => `sealed:${s}`, open: (s: string) => s.replace(/^sealed:/, '') },
      ports: {
        maps: {
          getMap: async (id: string) => (id === 'm1' ? { id, slug: 'home-chain', name: 'Home chain' } : null),
          listSystems: async () => systems,
          listConnections: async () => connections,
        },
        universe: { getSystem: universe, searchSystems: () => [] },
        db: {
          dialect: t.dialect,
          db: () => t.db.db(),
          transaction: <T>(work: () => Promise<T>) => t.db.transaction(work),
        },
        discord: {
          available: async () => true,
          channelLabel: async (guildId: string, channelId: string) =>
            guildId === '500' && channelId === '601' ? '#alerts on Hard Knocks' : null,
          send: async (channelId: string, body: Record<string, unknown>) =>
            void botPosts.push({ channelId, body }),
        },
        clock: { now: () => now },
      },
      consume: (c: DurableConsumer) => {
        consumers.push(c);
        return () => undefined;
      },
      http: { route: (r: PluginRoute) => routes.push(r) },
      audit: {
        configChanged: async (_r: PluginHttpRequest, change: PluginConfigChange) => void audits.push(change),
      },
      provide: () => undefined,
      settings: { get: async () => ({ username: 'Darkbeacon' }), forMap: async () => ({}) },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      metrics: { delivery: (channel: string, outcome: string) => deliveries.push(`${channel}:${outcome}`) },
    } as unknown as PluginContext<'maps' | 'universe' | 'db' | 'discord' | 'clock'>;

    app = new DiscordNotify(ctx, { fetch: fetchFn as typeof fetch, tickMs: 3_600_000 });
    app.start();
    const call = async (method: string, suffix: string, body?: unknown, mapRole: string | null = 'admin') => {
      const route = routes.find((r) => r.method === method && r.path === `/maps/:mapId${suffix}`)!;
      return (await route.handler({
        method,
        params: { mapId: 'm1' },
        query: {},
        body,
        accountId: 'a',
        mapRole,
      } as PluginHttpRequest)) as PluginHttpResponse & { body: unknown };
    };
    const state = async () => (await call('GET', '')).body as DiscordNotifyStateDto;
    let seq = 0;
    const emit = (type: string, data: unknown, at = now) =>
      t.db.transaction(() =>
        consumers[0]!.handle({
          id: `e${++seq}`,
          seq,
          stream: 'map:m1',
          type,
          occurredAt: at,
          actor: { kind: 'system', id: 't' },
          data,
          v: 1,
        } as DomainEvent),
      );
    return {
      app: app!,
      posts,
      botPosts,
      call,
      state,
      emit,
      audits,
      deliveries,
      systems,
      connections,
      now: () => now,
      setAnswer: (fn: () => Response) => (answer = fn),
      advance: (ms: number) => (now += ms),
    };
  }

  it('is managed by map admins and keeps the webhook URL secret', async () => {
    const s = await setup();
    expect((await s.call('GET', '', undefined, 'member')).status).toBe(403);
    expect((await s.call('GET', '', undefined, null)).status).toBe(404);
    expect(await s.state()).toMatchObject({ enabled: true, target: null, bot: true, status: { pending: 0 } });

    expect(
      (await s.call('PUT', '', { target: { kind: 'webhook', url: 'https://example.com/x' } })).status,
    ).toBe(400);
    const saved = await s.call('PUT', '', { target: { kind: 'webhook', url: HOOK } });
    expect((saved.body as DiscordNotifyStateDto).target).toEqual({
      kind: 'webhook',
      label: 'Webhook “Alerts”',
      guildId: null,
      channelId: null,
    });
    expect(JSON.stringify(saved.body)).not.toContain('abcdefghijklmnop');
    // The change is audited (the host keeps only a fingerprint of `webhookUrl`).
    expect(s.audits).toHaveLength(1);
    expect(s.audits[0]).toMatchObject({
      mapId: 'm1',
      before: null,
      after: { channel: 'Webhook “Alerts”', webhookUrl: HOOK },
    });

    // A bot channel is checked against what the bot sees.
    expect(
      (await s.call('PUT', '', { target: { kind: 'channel', guildId: '500', channelId: '999' } })).status,
    ).toBe(400);
    const channel = await s.call('PUT', '', {
      target: { kind: 'channel', guildId: '500', channelId: '601' },
    });
    expect((channel.body as DiscordNotifyStateDto).target?.label).toBe('#alerts on Hard Knocks');

    const test = await s.call('POST', '/test');
    expect(test.body).toEqual({ ok: true, error: null });
    expect(s.botPosts).toHaveLength(1);
    expect((await s.state()).status.lastSentAt).toBe(s.now());
  });

  it('turns map events into batched embeds, with mentions only for urgent kinds', async () => {
    const s = await setup();
    // Nothing is kept before a channel is connected.
    await s.emit('connection.added', connection('c0', 31000001, 31000002));
    await s.call('PUT', '', {
      target: { kind: 'webhook', url: HOOK },
      kinds: ALL,
      mention: { kind: 'here', roleId: null, kinds: ['eol'] },
    });
    expect((await s.state()).status.pending).toBe(0);

    await s.emit('connection.added', connection('c2', 31000001, 30002537));
    await s.emit('connection.updated', connection('c2', 31000001, 30002537, { timeStatus: 'eol' }));
    // The same state again says nothing new.
    await s.emit('connection.updated', connection('c2', 31000001, 30002537, { timeStatus: 'eol' }));
    await s.emit('character.jumped', { characterId: 2112000001, from: 30000142, to: 31000002 });
    // Moving inside the chain is not an arrival.
    await s.emit('character.jumped', { characterId: 2112000001, from: 31000002, to: 31000001 });
    // Read long after it happened (the plugin was off): not posted.
    await s.emit(
      'ping.created',
      { id: 'p', solarSystemId: 31000001, message: 'old', createdBy: 'a', createdAt: 0 },
      0,
    );
    expect((await s.state()).status.pending).toBe(3);

    // Inside the batch window nothing goes out; after it, one message with every embed.
    await s.app.flush();
    expect(s.posts).toHaveLength(0);
    s.advance(10_000);
    await s.app.flush();
    expect(s.posts).toHaveLength(1);
    const [post] = s.posts;
    expect(post).toMatchObject({
      username: 'Darkbeacon',
      content: '@here',
      allowed_mentions: { parse: ['everyone'] },
    });
    expect((post!.embeds as Array<{ title: string; url: string }>).map((e) => e.title)).toEqual([
      'New exit to Amamake (LS)',
      'End of life: J100001 (C3) ↔ Amamake (LS)',
      'Ayla Vex entered the chain',
    ]);
    expect((post!.embeds as Array<{ url: string }>)[0]!.url).toBe(
      'https://beacon.example/m/home-chain?system=30002537',
    );
    expect(await s.state()).toMatchObject({ status: { pending: 0, lastSentAt: s.now(), lastError: null } });
  });

  it('retries failed posts, waits out rate limits and reports the last error', async () => {
    const s = await setup();
    await s.call('PUT', '', { target: { kind: 'webhook', url: HOOK } });
    await s.emit('ping.created', {
      id: 'p',
      solarSystemId: 31000001,
      message: 'Form up',
      createdBy: 'a',
      createdAt: 0,
    });
    s.setAnswer(() => new Response(JSON.stringify({ retry_after: 2.5 }), { status: 429 }));
    s.advance(10_000);
    await s.app.flush();
    expect((await s.state()).status).toMatchObject({ pending: 1, lastError: null });

    s.setAnswer(() => new Response(JSON.stringify({ message: 'Oops' }), { status: 500 }));
    s.advance(3_000);
    await s.app.flush();
    expect((await s.state()).status).toMatchObject({ pending: 1, lastError: 'Discord answered 500: Oops' });

    s.setAnswer(() => new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    s.advance(10_000);
    await s.app.flush();
    expect(s.posts).toHaveLength(3);
    expect((await s.state()).status.pending).toBe(0);
    expect(s.deliveries).toEqual(['discord:failed', 'discord:failed', 'discord:ok']);
  });

  it('keeps quiet hours: only urgent kinds, and without mentions', async () => {
    const s = await setup();
    await s.call('PUT', '', {
      target: { kind: 'webhook', url: HOOK },
      kinds: ALL,
      mention: { kind: 'here', roleId: null, kinds: ['pings'] },
      quietHours: { enabled: true, start: '11:00', end: '13:00', timeZone: 'UTC' },
    });
    await s.emit('connection.added', connection('c3', 31000001, 31000002));
    await s.emit('ping.created', {
      id: 'p',
      solarSystemId: 31000001,
      message: 'Form up',
      createdBy: 'a',
      createdAt: 0,
    });
    s.advance(10_000);
    await s.app.flush();
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]).not.toHaveProperty('content');
    expect((s.posts[0]!.embeds as unknown[]).length).toBe(1);
  });

  it('posts the way home when exits change, and forgets a deleted map', async () => {
    const s = await setup();
    await s.call('PUT', '', {
      target: { kind: 'webhook', url: HOOK },
      kinds: { ...ALL, connections: false },
    });
    await s.emit('connection.added', connection('c1', 31000001, 30002537));
    await s.app.digests();
    s.advance(10_000);
    await s.app.flush();
    expect((s.posts[0]!.embeds as Array<{ title: string; description: string }>)[0]).toMatchObject({
      title: 'Way home: 1 exit to known space',
    });
    // Nothing changed: no second digest.
    await s.emit('connection.updated', connection('c1', 31000001, 30002537));
    s.advance(20 * 60_000);
    await s.app.digests();
    expect((await s.state()).status.pending).toBe(0);

    await s.emit('map.removed', { id: 'm1' });
    expect(await s.state()).toMatchObject({ target: null, status: { lastSentAt: null } });
  });
});
