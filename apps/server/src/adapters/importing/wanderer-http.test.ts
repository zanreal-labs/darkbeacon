import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseWandererBase, SourceError, type WandererApiRequest } from '@darkbeacon/importing';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeWanderer } from '../../test-support/fake-wanderer.js';
import { retryAfter, WandererHttpSource } from './wanderer-http.js';

const instant = { sleep: () => Promise.resolve(), retryDelayMs: () => 0, spacingMs: 0 };

const request = (
  url: string,
  apiKey: string,
  extra: Partial<WandererApiRequest> = {},
): WandererApiRequest => ({
  kind: 'wanderer-api',
  base: parseWandererBase(url, { allowPlainHttp: true }),
  slug: 'home-chain',
  apiKey,
  aclKeys: [],
  insecureTls: false,
  allowPrivate: true,
  ...extra,
});

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
});

/** A scripted instance: `handle` answers each request; returns its address and the requests seen. */
async function scripted(handle: (req: IncomingMessage, res: ServerResponse, n: number) => void) {
  const seen: string[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(req.url ?? '');
    handle(req, res, seen.length);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  closers.push(() => new Promise((done) => server.close(() => done())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

describe('WandererHttpSource against a fake Wanderer', () => {
  it('reads a whole map: systems with hidden ones, connections, signatures, structures, comments, ACLs', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    const source = new WandererHttpSource(instant);
    const steps: string[] = [];
    const dump = await source.read(request(fake.url, fake.map.apiKey), (s) => steps.push(s));

    expect(dump.source).toMatchObject({ kind: 'wanderer-api', slug: 'home-chain', name: 'Home Chain' });
    expect(dump.systems).toHaveLength(30);
    expect(dump.systems.filter((s) => !s.visible)).toHaveLength(2);
    expect(dump.connections).toHaveLength(fake.map.connections.length);
    expect(dump.signatures).toHaveLength(fake.map.signatures.length);
    expect(dump.structures).toHaveLength(4);
    expect(dump.comments).toHaveLength(3);
    expect(dump.comments[0]!.systemUuid).toBeTruthy();
    expect(dump.map.scope).toBe('wormholes');
    expect(dump.trackedCharacters).toBe(3);
    // Two ACLs readable with the map key; the third needs its own key.
    expect(dump.acls.map((a) => [a.name, a.members?.length ?? null])).toEqual([
      ['Corp', 4],
      ['Allies', 4],
      ['Officers', null],
    ]);
    expect(dump.acls[2]!.error).toMatch(/ACL API key/);
    expect(steps).toEqual([
      'systems',
      'connections',
      'signatures',
      'structures',
      'comments',
      'passages',
      'access',
      'map',
      'hubs',
      'webhooks',
    ]);
    // Hubs from the map's user settings, most used first; webhooks without their secrets.
    expect(dump.hubs).toEqual([30000142, 30002187, 30002659]);
    expect(dump.webhooks!.map((w) => [w.id, w.events.length, w.active])).toEqual([
      ['wh-chain', 6, true],
      ['wh-kills', 1, true],
      ['wh-all', 1, false],
    ]);
    expect(JSON.stringify(dump)).not.toContain('wanderer-secret-never-read');
    // Comment authors come with the comments (JSON:API include), passages one by one.
    expect(dump.comments[0]).toMatchObject({ authorName: 'CCP Bartender', authorEveId: '2112625428' });
    expect(dump.passages).toHaveLength(5);
    expect(dump.passages![0]).toMatchObject({ characterEveId: 2112625428, shipTypeId: 605 });
    expect(fake.log.some((l) => l.startsWith('GET /api/map/systems?slug=home-chain&all=true'))).toBe(true);

    const withKey = await source.read(
      request(fake.url, fake.map.apiKey, {
        aclKeys: [{ aclId: fake.map.acls[2]!.id, key: 'acl-officers-key' }],
      }),
    );
    expect(withKey.acls[2]!.members).toEqual([
      { kind: 'character', eveId: '2116161003', name: 'Fleet Boss', role: 'admin' },
    ]);
  });

  it('pages through JSON:API collections when the older signature route is missing', async () => {
    const fake = await startFakeWanderer({ legacySignatures: false });
    closers.push(fake.close);
    const dump = await new WandererHttpSource(instant).read(request(fake.url, fake.map.apiKey));
    expect(dump.signatures).toHaveLength(fake.map.signatures.length);
    const pages = fake.log.filter((l) => l.startsWith('GET /api/v1/map_system_signatures'));
    expect(pages.length).toBe(1);
    // Every signature knows its system through the relationship.
    expect(dump.signatures.every((s) => s.systemUuid)).toBe(true);
  });

  it('follows offset pages when Wanderer gives no next link', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      id: `s${i}`,
      type: 'map_system_signatures',
      attributes: {
        eve_id: `ABC-${String(100 + (i % 900)).padStart(3, '0')}`,
        solar_system_id: 31002531,
        kind: 'Cosmic Signature',
      },
    }));
    const { url, seen } = await scripted((req, res) => {
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/api/map/systems') return send(res, 200, { data: [{ solar_system_id: 31002531 }] });
      if (u.pathname === '/api/v1/map_system_signatures') {
        const offset = Number(u.searchParams.get('page[offset]'));
        const limit = Number(u.searchParams.get('page[limit]'));
        return send(res, 200, { data: rows.slice(offset, offset + limit) });
      }
      if (u.pathname === '/api/map/acls') return send(res, 200, { data: [] });
      send(res, 404, { error: 'Not found' });
    });
    const dump = await new WandererHttpSource(instant).read(request(url, 'k'));
    expect(dump.signatures).toHaveLength(450);
    expect(seen.filter((s) => s.startsWith('/api/v1/map_system_signatures'))).toEqual([
      '/api/v1/map_system_signatures?page[limit]=200&page[offset]=0',
      '/api/v1/map_system_signatures?page[limit]=200&page[offset]=200',
      '/api/v1/map_system_signatures?page[limit]=200&page[offset]=400',
    ]);
    expect(dump.warnings).toContain('Structures: this Wanderer does not offer them over the API');
  });

  it('says so when the key is refused (401)', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    const source = new WandererHttpSource(instant);
    const error = await source.read(request(fake.url, 'wrong')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({
      failure: 'auth',
      message: expect.stringMatching(/refused the API key \(401\)/),
    });
  });

  it('says so when the map does not exist', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    const error = await new WandererHttpSource(instant)
      .read({ ...request(fake.url, fake.map.apiKey), slug: 'nope' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: 'not_found' });
  });

  it('waits out 429 answers with Retry-After', async () => {
    const fake = await startFakeWanderer({ rateLimitEvery: 3 });
    closers.push(fake.close);
    const waits: number[] = [];
    const source = new WandererHttpSource({ ...instant, sleep: (ms) => (waits.push(ms), Promise.resolve()) });
    const dump = await source.read(request(fake.url, fake.map.apiKey));
    expect(dump.systems).toHaveLength(30);
    expect(waits.filter((w) => w === 1000).length).toBeGreaterThan(2);
  });

  it('gives up on a 429 that keeps coming', async () => {
    const { url } = await scripted((_req, res) => send(res, 429, {}, { 'retry-after': '1' }));
    const error = await new WandererHttpSource(instant).test(request(url, 'k')).catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: 'rate_limited' });
  });

  it('retries 5xx answers and network errors, then reports the instance as unavailable', async () => {
    const { url, seen } = await scripted((req, res, n) => {
      if (n <= 2) return send(res, 502, {});
      send(res, 200, { data: [{ solar_system_id: 31002531 }, { solar_system_id: 30000142 }] });
    });
    expect(await new WandererHttpSource(instant).test(request(url, 'k'))).toEqual({ systems: 2, name: null });
    expect(seen).toHaveLength(3);

    const down = await scripted((_req, res) => send(res, 503, {}));
    const error = await new WandererHttpSource(instant).test(request(down.url, 'k')).catch((e: unknown) => e);
    expect(error).toMatchObject({ failure: 'unavailable' });
    expect(down.seen).toHaveLength(3);

    const nobody = await new WandererHttpSource(instant)
      .test(request('http://127.0.0.1:9', 'k'))
      .catch((e: unknown) => e);
    expect(nobody).toMatchObject({
      failure: 'unavailable',
      message: expect.stringMatching(/did not answer/),
    });
  });

  it('refuses private addresses unless allowed, and never follows redirects', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    const refused = await new WandererHttpSource(instant)
      .test(request(fake.url, fake.map.apiKey, { allowPrivate: false }))
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({
      failure: 'refused',
      message: expect.stringMatching(/private or local address/),
    });

    const named = await new WandererHttpSource(instant)
      .test(request(fake.url.replace('127.0.0.1', 'localhost'), fake.map.apiKey, { allowPrivate: false }))
      .catch((e: unknown) => e);
    expect(named).toMatchObject({ failure: 'refused' });

    const { url } = await scripted((_req, res) => {
      res.writeHead(302, { location: 'https://elsewhere.example/api' });
      res.end();
    });
    const redirect = await new WandererHttpSource(instant).test(request(url, 'k')).catch((e: unknown) => e);
    expect(redirect).toMatchObject({
      failure: 'refused',
      message: expect.stringMatching(/redirects to https:\/\/elsewhere/),
    });
  });

  it('refuses answers that are not JSON or too large', async () => {
    const html = await scripted((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>hello</html>');
    });
    expect(
      await new WandererHttpSource(instant).test(request(html.url, 'k')).catch((e: unknown) => e),
    ).toMatchObject({
      failure: 'invalid',
    });
    const big = await scripted((_req, res) => send(res, 200, { data: 'x'.repeat(5000) }));
    expect(
      await new WandererHttpSource({ ...instant, maxBytes: 1000 })
        .test(request(big.url, 'k'))
        .catch((e: unknown) => e),
    ).toMatchObject({ failure: 'invalid' });
  });

  it('reads Retry-After in seconds and as a date', () => {
    expect(retryAfter('2', 0)).toBe(2000);
    expect(retryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfter(undefined, 0)).toBe(5000);
  });
});
