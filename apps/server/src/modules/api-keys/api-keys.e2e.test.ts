import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import {
  routes,
  type ApiKeyDto,
  type AuditPageDto,
  type CreatedApiKeyDto,
  type MapDto,
  type MapSummaryDto,
  type MeDto,
  type RouteDef,
  type ServerMessage,
} from '@darkbeacon/shared';
import WebSocket from 'ws';
import { createApp, registeredRoutes } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { routeFor } from '../../platform/route-index.js';
import { Browser } from '../../test-support/browser.js';

const JITA = 30000142;
const PERIMETER = 30000144;

describeEachDialect('API keys over HTTP and WebSocket', (t) => {
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
    const me = await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: `${name} Main` } },
    });
    await browser.json('/api/accounts/me/main-character', {
      method: 'PUT',
      json: { characterId: me.characters[0]!.id },
    });
    return browser;
  };

  /** A request with an API key (and nothing else: no cookies). */
  const withKey = (
    token: string,
    path: string,
    init: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
  ) =>
    fetch(`http://${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });

  const createKey = (browser: Browser, body: Record<string, unknown>) =>
    browser.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { allowedIps: [], ...body },
    });

  it('acts as its owner, only within its scopes, and records "via key" in the history', async () => {
    const alice = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const other = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Other' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: JITA } });

    const { token, key } = await createKey(alice, {
      name: 'Scanner',
      scopes: [`map:${map.id}:systems:write`, `map:${map.id}:maps:read`],
    });
    expect(token).toMatch(/^dbk_pat_[0-9A-Za-z]{50}$/);
    // The token is shown once: listing never returns it.
    const listed = await alice.json<ApiKeyDto[]>('/api/accounts/me/api-keys');
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed[0]).toMatchObject({ id: key.id, name: 'Scanner', maps: [{ id: map.id, name: 'Chain' }] });

    // Only the map its scopes name is visible, through /api and the versioned alias.
    const maps = (await (await withKey(token, '/api/maps')).json()) as MapSummaryDto[];
    expect(maps.map((x) => x.id)).toEqual([map.id]);
    expect((await withKey(token, `/api/v1/maps/${map.id}`)).status).toBe(200);
    expect((await withKey(token, `/api/maps/${other.id}`)).status).toBe(403);

    // Allowed: adding a system. Refused: what the scopes do not name, with a Bearer challenge.
    const added = await withKey(token, `${m}/systems`, {
      method: 'POST',
      json: { solarSystemId: PERIMETER },
    });
    expect(added.status).toBe(201);
    const sig = await withKey(token, `${m}/systems/${JITA}/signatures`, {
      method: 'POST',
      json: { eveId: 'ABC-123' },
    });
    expect(sig.status).toBe(403);
    expect(sig.headers.get('www-authenticate')).toMatch(
      /error="insufficient_scope".*scope="signatures:write"/,
    );
    expect((await withKey(token, m, { method: 'PATCH', json: { name: 'Mine' } })).status).toBe(403);
    // Session-only routes refuse every key, even one with every scope.
    expect((await withKey(token, '/api/accounts/me/sessions')).status).toBe(403);
    expect((await withKey(token, '/api/accounts/me/api-keys')).status).toBe(403);

    // The change shows who made it and through which key.
    const history = await alice.json<AuditPageDto>(`${m}/history`);
    const entry = history.entries.find(
      (e) => e.type === 'system.added' && e.entity?.id === String(PERIMETER),
    )!;
    expect(entry.actor).toMatchObject({ kind: 'account', accountName: 'alice' });
    expect(entry.channel).toEqual({ kind: 'api', id: key.id, name: 'Scanner' });

    // The key was used: last used at and from where.
    const after = await alice.json<ApiKeyDto[]>('/api/accounts/me/api-keys');
    expect(after[0]!.lastUsedAt).not.toBeNull();
    expect(after[0]!.lastUsedIp).toBe('127.0.0.1');
  });

  it('cannot exceed what the owner may do, and follows the owner when that changes', async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    // Bob cannot name a map he cannot see.
    const refused = await bob.request('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { name: 'x', scopes: [`map:${map.id}:maps:read`], allowedIps: [] },
    });
    expect(refused.status).toBe(404);
    // An all-maps key of bob sees nothing of alice's map.
    const { token } = await createKey(bob, { name: 'all', scopes: ['*:*'] });
    expect((await withKey(token, `/api/maps/${map.id}`)).status).toBe(404);
    // Bob becomes a viewer: the key reads, but cannot write although its scopes would.
    await alice.json(`/api/maps/${map.id}/access-rules`, {
      method: 'POST',
      json: {
        subjectKind: 'account',
        subjectId: (await bob.json<MeDto>('/api/accounts/me')).account.id,
        role: 'viewer',
      },
    });
    expect((await withKey(token, `/api/maps/${map.id}`)).status).toBe(200);
    expect(
      (await withKey(token, `/api/maps/${map.id}/systems`, { method: 'POST', json: { solarSystemId: JITA } }))
        .status,
    ).toBe(403);
    // Admin scopes need an instance admin (alice is the first account, the owner).
    expect(
      (
        await bob.request('/api/accounts/me/api-keys', {
          method: 'POST',
          json: { name: 'a', scopes: ['admin:read'], allowedIps: [] },
        })
      ).status,
    ).toBe(403);
    const admin = await createKey(alice, { name: 'admin', scopes: ['admin:read'] });
    expect((await withKey(admin.token, '/api/admin/accounts')).status).toBe(200);
    expect(
      (await withKey(admin.token, '/api/admin/settings', { method: 'PATCH', json: { publicMaps: false } }))
        .status,
    ).toBe(403);
  });

  it('refuses read-only, expired, revoked and out-of-range keys, and invalid tokens with 401', async () => {
    const alice = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const ro = await createKey(alice, { name: 'ro', scopes: ['*:*'], readOnly: true });
    expect((await withKey(ro.token, `/api/maps/${map.id}`)).status).toBe(200);
    expect(
      (
        await withKey(ro.token, `/api/maps/${map.id}/systems`, {
          method: 'POST',
          json: { solarSystemId: JITA },
        })
      ).status,
    ).toBe(403);

    const fenced = await createKey(alice, {
      name: 'office',
      scopes: ['maps:read'],
      allowedIps: ['203.0.113.0/24'],
    });
    const denied = await withKey(fenced.token, '/api/maps');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);

    const soon = await createKey(alice, {
      name: 'soon',
      scopes: ['maps:read'],
      expiresAt: Date.now() + 1500,
    });
    expect((await withKey(soon.token, '/api/maps')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1600));
    expect((await withKey(soon.token, '/api/maps')).status).toBe(401);

    const gone = await createKey(alice, { name: 'gone', scopes: ['maps:read'] });
    await alice.request(`/api/accounts/me/api-keys/${gone.key.id}`, { method: 'DELETE' });
    const revoked = await withKey(gone.token, '/api/maps');
    expect(revoked.status).toBe(401);
    expect(((await revoked.json()) as { error: { message: string } }).error.message).toMatch(/revoked/);

    // A rotated key works with its new secret only.
    const rot = await createKey(alice, { name: 'rot', scopes: ['maps:read'] });
    const next = await alice.json<CreatedApiKeyDto>(`/api/accounts/me/api-keys/${rot.key.id}/rotate`, {
      method: 'POST',
    });
    expect((await withKey(rot.token, '/api/maps')).status).toBe(401);
    expect((await withKey(next.token, '/api/maps')).status).toBe(200);
  });

  it('limits failed tokens per address and requests per key', async () => {
    const alice = await signIn('alice');
    const limited = await createKey(alice, { name: 'slow', scopes: ['maps:read'], rateLimitPerMinute: 2 });
    expect((await withKey(limited.token, '/api/maps')).status).toBe(200);
    expect((await withKey(limited.token, '/api/maps')).status).toBe(200);
    const third = await withKey(limited.token, '/api/maps');
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);

    const fake = `dbk_pat_${'A'.repeat(50)}`;
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await withKey(fake, '/api/maps')).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('binds service keys to the roles an admin gives them', async () => {
    const alice = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    await alice.json(`/api/maps/${map.id}/systems`, { method: 'POST', json: { solarSystemId: JITA } });
    const { token, key } = await alice.json<CreatedApiKeyDto>('/api/admin/service-keys', {
      method: 'POST',
      json: {
        name: 'Corp bot',
        scopes: ['*:read'],
        allowedIps: [],
        mapGrants: [{ mapId: map.id, role: 'viewer' }],
      },
    });
    expect(token).toMatch(/^dbk_svc_/);
    expect((await withKey(token, `/api/maps/${map.id}/connections/intel`)).status).toBe(200);
    expect((await withKey(token, '/api/universe/systems?q=Jita')).status).toBe(200);
    expect(
      (
        await withKey(token, `/api/maps/${map.id}/systems`, {
          method: 'POST',
          json: { solarSystemId: PERIMETER },
        })
      ).status,
    ).toBe(403);
    const all = await alice.json<ApiKeyDto[]>('/api/admin/api-keys');
    expect(all.find((k) => k.id === key.id)).toMatchObject({
      kind: 'svc',
      mapGrants: [{ mapId: map.id, role: 'viewer' }],
    });
  });

  it('follows map streams over /ws with a key that reads everything there', async () => {
    const alice = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    const reader = await createKey(alice, { name: 'reader', scopes: [`map:${map.id}:*`], readOnly: true });
    const narrow = await createKey(alice, { name: 'narrow', scopes: ['routes:read'] });

    const follow = async (token: string) => {
      const socket = new WebSocket(`ws://${base}/ws`, { headers: { authorization: `Bearer ${token}` } });
      const messages: ServerMessage[] = [];
      socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
      await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
      socket.send(JSON.stringify({ op: 'subscribe', stream: `map:${map.id}` }));
      await vi.waitFor(() =>
        expect(messages.some((x) => x.op === 'subscribed' || x.op === 'error')).toBe(true),
      );
      socket.close();
      return messages;
    };
    expect((await follow(reader.token)).some((x) => x.op === 'subscribed')).toBe(true);
    expect((await follow(narrow.token)).find((x) => x.op === 'error')).toMatchObject({ code: 'forbidden' });
  });

  it('answers CORS only for allowed origins and never with cookies', async () => {
    const alice = await signIn('alice');
    const preflight = (origin: string) =>
      fetch(`http://${base}/api/maps`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
    expect((await preflight('https://tools.example.com')).status).toBe(403);
    await alice.json('/api/admin/settings', {
      method: 'PATCH',
      json: { apiCorsOrigins: ['https://tools.example.com'] },
    });
    const ok = await preflight('https://tools.example.com');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://tools.example.com');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    expect(ok.headers.get('access-control-allow-headers')).toContain('authorization');

    // A cross-origin request with the session cookie is anonymous: cookies never count there.
    const crossSite = await fetch(`http://${base}/api/accounts/me`, {
      headers: { cookie: alice.cookieHeader, origin: 'https://tools.example.com' },
    });
    expect(crossSite.status).toBe(401);
    const sameSite = await fetch(`http://${base}/api/accounts/me`, {
      headers: { cookie: alice.cookieHeader, origin: 'http://dbk.test' },
    });
    expect(sameSite.status).toBe(200);
  });

  it('implements exactly the routes of the contract, each documented with its scope', async () => {
    const contract = new Set(
      Object.values(routes).flatMap((g) =>
        ('method' in g ? [g as RouteDef] : Object.values(g as Record<string, RouteDef>)).map(
          (r) => `${r.method} ${r.path}`,
        ),
      ),
    );
    const served = registeredRoutes(app)
      .filter((r) => r.url.startsWith('/api') && !['HEAD', 'OPTIONS'].includes(r.method))
      // Plugin routes are the plugins' own (see docs/api.md).
      .filter((r) => !r.url.startsWith('/api/plugins/:pluginId/') || r.url.endsWith('/assets/:file'))
      .map((r) => `${r.method} ${r.url}`);
    const unknown = served.filter((key) => {
      const [method, url] = key.split(' ') as [string, string];
      return !routeFor(method, url);
    });
    expect(unknown).toEqual([]);
    // Routes a bundled plugin serves (discord-notify) exist once the plugin runs, not in tests.
    const missing = [...contract].filter(
      (key) => !served.includes(key) && !/ \/api\/plugins\/[a-z-]+\/maps\//.test(key),
    );
    expect(missing).toEqual([]);
  });
});
