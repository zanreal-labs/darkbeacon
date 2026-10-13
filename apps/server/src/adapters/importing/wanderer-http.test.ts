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
const plain = (res: ServerResponse, status: number, body: string) => {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(body);
};

describe('WandererHttpSource against a fake Wanderer (real answer shapes)', () => {
  it('reads a whole map: hidden systems with their intel, connection details, every part', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    const source = new WandererHttpSource(instant);
    const steps: string[] = [];
    const dump = await source.read(request(fake.url, fake.map.apiKey), (s) => steps.push(s));

    expect(dump.source).toMatchObject({ kind: 'wanderer-api', slug: 'home-chain', name: 'Home Chain' });
    expect(dump.systems).toHaveLength(30);
    // Hidden systems come from the map export, with their place, notes, labels and Wanderer ids.
    const hidden = dump.systems.filter((s) => !s.visible);
    expect(hidden.map((s) => s.solarSystemId).sort()).toEqual([31002385, 31002404]);
    expect(hidden.find((s) => s.solarSystemId === 31002385)).toMatchObject({
      uuid: expect.any(String),
      rawName: 'Dead end',
      description: 'Old static, Sansha fleet lives here',
      tag: 'OLD',
      status: 6,
      position: { x: 720, y: 300 },
      labels: { ids: ['b'], custom: 'OLD' },
    });
    // The REST answer names systems as shown (temporary name first) and resolves the custom name.
    expect(dump.systems.find((s) => s.solarSystemId === 31001924)).toMatchObject({
      customName: 'Farm',
      temporaryName: '2b',
      rawName: null,
      status: 6,
    });
    expect(dump.systems.find((s) => s.solarSystemId === 31000399)).toMatchObject({
      customName: null,
      temporaryName: '1a',
    });
    // Notes, marks and passage counts only JSON:API gives.
    expect(dump.connections).toHaveLength(fake.map.connections.length);
    const noted = dump.connections.find((c) => c.customInfo === 'Rolled once, second roll pending');
    expect(noted).toBeTruthy();
    expect(dump.connections.find((c) => c.countOfPassage === 7)).toBeTruthy();
    expect(dump.connections.some((c) => c.dangerous && c.bubbled === 2)).toBe(true);
    // Every signature that is not deleted, the hidden system's too.
    expect(dump.signatures).toHaveLength(fake.map.signatures.filter((s) => !s.deleted).length);
    expect(dump.signatures.find((s) => s.eveId === 'HID-001')).toMatchObject({ solarSystemId: 31002385 });
    expect(dump.signatures.some((s) => s.eveId === 'DEL-404')).toBe(false);
    expect(dump.signatures.find((s) => s.eveId === 'DKM-763')!.insertedAt).toBeGreaterThan(0);
    expect(dump.structures).toHaveLength(5);
    expect(dump.structures.find((s) => s.name === 'Sansha Tower')).toMatchObject({ solarSystemId: 31002385 });
    // Comments with their authors, from the tracked characters (JSON:API gives Wanderer's ids only).
    expect(dump.comments).toHaveLength(4);
    expect(dump.comments.find((c) => c.text.startsWith('Neut Loki'))).toMatchObject({
      authorName: 'Scout Alt',
      authorEveId: '2116161001',
    });
    expect(dump.comments.find((c) => c.text === 'Do not jump in solo')!.systemUuid).toBe(
      fake.map.systems.find((s) => s.solar_system_id === 31002385)!.id,
    );
    // Every ACL's members over JSON:API with the map key alone.
    expect(dump.acls.map((a) => [a.name, a.members?.length ?? null, a.error])).toEqual([
      ['Corp', 4, null],
      ['Allies', 4, null],
      ['Officers', 1, null],
    ]);
    // The map's label list comes with the export.
    expect(dump.systemLabels!.map((l) => l.name)).toEqual(['A', 'B', '1', 'Exit']);
    expect(dump.map).toMatchObject({
      scope: 'wormholes',
      scopes: ['wormholes'],
      description: 'Our main chain',
    });
    expect(dump.trackedCharacters).toBe(3);
    // The recorded fork's export has no `map.hubs`: the map takes its users' hubs, and says so.
    expect(dump.hubs).toEqual([30000142, 30002187, 30002659]);
    expect(dump.userHubs).toEqual([
      { characterEveId: 2112625428, hubs: [30000142, 30002187] },
      { characterEveId: 2112625429, hubs: [30000142, 30002659] },
    ]);
    expect(dump.webhooks!.map((w) => [w.id, w.events.length, w.active])).toEqual([
      ['wh-chain', 6, true],
      ['wh-kills', 1, true],
      ['wh-all', 1, false],
    ]);
    expect(JSON.stringify(dump)).not.toContain('wanderer-secret-never-read');
    // Wanderer's API has no passages one by one.
    expect(dump.passages).toEqual([]);
    expect(dump.warnings).toEqual([expect.stringMatching(/does not give the map's own hubs.*users set/)]);
    expect(steps).toEqual([
      'systems',
      'connections',
      'signatures',
      'structures',
      'comments',
      'access',
      'map',
      'hubs',
      'webhooks',
    ]);
    expect(fake.log.some((l) => l.startsWith('GET /api/v1/map_chain_passages'))).toBe(false);
  });

  it("takes the map's own hubs from an export that has them, wormholes included", async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    // As `maps_v1.hubs` of a real map: the wormhole home among the trade hubs, as numbers.
    fake.map.map.hubs = [30004455, 31001269, 30002659, 30000142];
    const dump = await new WandererHttpSource(instant).read(request(fake.url, fake.map.apiKey));
    expect(dump.hubs).toEqual([30004455, 31001269, 30002659, 30000142]);
    expect(dump.userHubs).toHaveLength(2);
    expect(dump.warnings).toEqual([]);
  });

  it('counts shown and hidden systems when testing the connection', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    expect(await new WandererHttpSource(instant).test(request(fake.url, fake.map.apiKey))).toEqual({
      systems: 28,
      hiddenSystems: 2,
      name: null,
    });
  });

  it('reads hidden systems over JSON:API where the instance has no map export, and says what is missing', async () => {
    const fake = await startFakeWanderer({ export: false });
    closers.push(fake.close);
    const dump = await new WandererHttpSource(instant).read(request(fake.url, fake.map.apiKey));
    expect(dump.systems.filter((s) => !s.visible)).toHaveLength(2);
    expect(dump.systems.find((s) => s.solarSystemId === 31002385)).toMatchObject({
      visible: false,
      position: null,
      description: 'Old static, Sansha fleet lives here',
      rawName: 'Dead end',
    });
    expect(dump.systemLabels).toEqual([]);
    expect(dump.warnings).toEqual([
      expect.stringMatching(/label names cannot be read over its API.*database/),
      expect.stringMatching(/without their place on the map or lock.*database/),
      expect.stringMatching(/does not give the map's own hubs/),
    ]);
    // The hidden system's intel still comes (JSON:API lists every row of the map).
    expect(dump.signatures.some((s) => s.eveId === 'HID-001')).toBe(true);
    expect(dump.comments).toHaveLength(4);
  });

  it('follows JSON:API next links by their path, whatever address Wanderer writes into them', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      id: `s${i}`,
      type: 'map_system_signatures',
      attributes: {
        eve_id: `ABC-${String(100 + i).padStart(3, '0')}`,
        kind: 'Cosmic Signature',
        deleted: false,
      },
      relationships: { system: { data: { id: 'sys-1', type: 'map_systems' }, links: {}, meta: {} } },
    }));
    const { url, seen } = await scripted((req, res) => {
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/api/maps/home-chain/systems')
        return send(res, 200, {
          data: { systems: [{ id: 'sys-1', solar_system_id: 31002531 }], connections: [] },
        });
      if (u.pathname === '/api/v1/map_system_signatures') {
        const offset = Number(u.searchParams.get('page[offset]'));
        const limit = Number(u.searchParams.get('page[limit]'));
        const next = offset + limit < rows.length;
        return send(res, 200, {
          data: rows.slice(offset, offset + limit),
          // Behind a proxy Wanderer writes its own idea of its address.
          links: {
            next: next
              ? `http://internal:4000/api/v1/map_system_signatures?include=system&page[offset]=${offset + limit}&page[limit]=${limit}`
              : null,
          },
          meta: { page: {} },
        });
      }
      send(res, 404, { errors: { detail: 'Not Found' } });
    });
    const dump = await new WandererHttpSource(instant).read(request(url, 'k'));
    expect(dump.signatures).toHaveLength(450);
    expect(dump.signatures.every((s) => s.solarSystemId === 31002531)).toBe(true);
    expect(seen.filter((s) => s.startsWith('/api/v1/map_system_signatures'))).toEqual([
      '/api/v1/map_system_signatures?include=system&page[limit]=200&page[offset]=0',
      '/api/v1/map_system_signatures?include=system&page[offset]=200&page[limit]=200',
      '/api/v1/map_system_signatures?include=system&page[offset]=400&page[limit]=200',
    ]);
  });

  it('stops paging when an instance answers the same rows again', async () => {
    const { url, seen } = await scripted((req, res) => {
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/api/maps/home-chain/systems')
        return send(res, 200, {
          data: { systems: [{ id: 'sys-1', solar_system_id: 31002531 }], connections: [] },
        });
      if (u.pathname === '/api/v1/map_system_comments')
        return send(res, 200, {
          data: [{ id: 'c1', type: 'map_system_comments', attributes: { text: 'hi' }, relationships: {} }],
          links: { next: '/api/v1/map_system_comments?page[offset]=100' },
        });
      send(res, 404, {});
    });
    const dump = await new WandererHttpSource(instant).read(request(url, 'k'));
    expect(dump.comments).toHaveLength(1);
    expect(seen.filter((s) => s.startsWith('/api/v1/map_system_comments'))).toHaveLength(2);
  });

  it('reads the old routes of a Wanderer without /api/maps (systems as a list)', async () => {
    const { url } = await scripted((req, res) => {
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/api/map/systems')
        return send(res, 200, {
          data: [{ solar_system_id: 31002531, name: 'J014348', original_name: 'J014348' }],
        });
      if (u.pathname === '/api/map/connections')
        return send(res, 200, { data: [{ solar_system_source: 31002531, solar_system_target: 30002187 }] });
      if (u.pathname === '/api/map/acls') return send(res, 200, { data: [] });
      send(res, 404, { errors: { detail: 'Not Found' } });
    });
    const dump = await new WandererHttpSource(instant).read(request(url, 'k'));
    expect(dump.systems).toHaveLength(1);
    expect(dump.connections).toHaveLength(1);
    expect(dump.warnings).toContain(
      "Hidden systems cannot be read over this Wanderer's API; only the shown ones were read. Import from Wanderer's database to get them.",
    );
  });

  it('reads members with an ACL key where JSON:API is missing, and says which ACLs need one', async () => {
    const { url } = await scripted((req, res) => {
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/api/maps/home-chain/systems')
        return send(res, 200, { data: { systems: [{ solar_system_id: 31002531 }], connections: [] } });
      if (u.pathname === '/api/map/acls')
        return send(res, 200, {
          data: [
            { id: 'acl-1', name: 'Corp' },
            { id: 'acl-2', name: 'Blues' },
            { id: 'acl-3', name: 'Keyless' },
          ],
        });
      if (u.pathname === '/api/acls/acl-1')
        return req.headers.authorization === 'Bearer corp-key'
          ? send(res, 200, {
              data: { members: [{ name: 'Pilot', role: 'admin', eve_character_id: '2112625428' }] },
            })
          : plain(res, 401, 'Unauthorized (invalid API key for ACL)');
      if (u.pathname === '/api/acls/acl-3') return plain(res, 401, 'Unauthorized (no API key set for ACL)');
      send(res, 404, { errors: { detail: 'Not Found' } });
    });
    const dump = await new WandererHttpSource(instant).read(
      request(url, 'k', {
        aclKeys: [
          { aclId: 'acl-1', key: 'corp-key' },
          { aclId: 'acl-3', key: 'any' },
        ],
      }),
    );
    expect(dump.acls.map((a) => [a.name, a.members?.length ?? null, a.error])).toEqual([
      ['Corp', 1, null],
      ['Blues', null, expect.stringMatching(/needs the ACL API key/)],
      ['Keyless', null, expect.stringMatching(/has no API key in Wanderer/)],
    ]);
  });

  it('says so when the key is refused (401)', async () => {
    const fake = await startFakeWanderer();
    closers.push(fake.close);
    const error = await new WandererHttpSource(instant)
      .read(request(fake.url, 'wrong'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({
      failure: 'auth',
      message: expect.stringMatching(/refused the API key \(401\)/),
    });
  });

  it('tells an inactive subscription and a switched-off API apart from a wrong key', async () => {
    const lapsed = await scripted((_req, res) =>
      plain(res, 401, 'Unauthorized (map subscription not active)'),
    );
    expect(
      await new WandererHttpSource(instant).test(request(lapsed.url, 'k')).catch((e: unknown) => e),
    ).toMatchObject({
      failure: 'auth',
      message: expect.stringMatching(/subscription is not active/),
    });
    const off = await scripted((_req, res) => plain(res, 403, 'Public API is disabled'));
    expect(
      await new WandererHttpSource(instant).test(request(off.url, 'k')).catch((e: unknown) => e),
    ).toMatchObject({
      failure: 'refused',
      message: expect.stringMatching(/WANDERER_PUBLIC_API_DISABLED/),
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
      if (req.url === '/api/maps/home-chain/systems')
        return send(res, 200, {
          data: { systems: [{ solar_system_id: 31002531 }, { solar_system_id: 30000142 }] },
        });
      send(res, 404, {});
    });
    expect(await new WandererHttpSource(instant).test(request(url, 'k'))).toEqual({
      systems: 2,
      hiddenSystems: null,
      name: null,
    });
    expect(seen.slice(0, 3)).toEqual([
      '/api/maps/home-chain/systems',
      '/api/maps/home-chain/systems',
      '/api/maps/home-chain/systems',
    ]);

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
