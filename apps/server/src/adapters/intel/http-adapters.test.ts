import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import type { Killmail } from '@darkbeacon/intel';
import {
  EsiActivitySource,
  EsiNameResolver,
  EsiPublicClient,
  EsiSovereigntySource,
} from './esi-intel-http.js';
import { parseKillPackage, R2z2KillFeed, ZkillHistory } from './zkill-http.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

/** A fake ESI / zKillboard on a loopback port: one handler per path, every request recorded. */
class FakeServer {
  readonly requests: Array<{
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: string;
  }> = [];
  readonly routes = new Map<string, Handler>();
  private server!: Server;
  base = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        this.requests.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        const path = req.url!.split('?')[0]!;
        const handler = this.routes.get(path) ?? this.routes.get('*');
        if (handler) handler(req, res, body);
        else res.writeHead(404).end('{"error":"not found"}');
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));

const killPackage = (id: number, systemId: number, time = '2026-10-12T13:55:00Z') => ({
  killmail_id: id,
  hash: `hash${id}`,
  esi: {
    killmail_id: id,
    killmail_time: time,
    solar_system_id: systemId,
    victim: { character_id: 90000001, corporation_id: 98000001, alliance_id: 99000001, ship_type_id: 587 },
    attackers: [
      {
        character_id: 90000002,
        corporation_id: 98000002,
        alliance_id: 99000002,
        ship_type_id: 11987,
        final_blow: true,
      },
      {
        character_id: 90000003,
        corporation_id: 98000002,
        alliance_id: 99000002,
        ship_type_id: 11987,
        final_blow: false,
      },
      { faction_id: 500010, ship_type_id: 23707, final_blow: false },
    ],
  },
  zkb: { hash: `hash${id}`, totalValue: 12_500_000, npc: false, solo: false, attackerCount: 3 },
});

let fake: FakeServer;
let clock: ManualClock;
const NOW = Date.UTC(2026, 9, 12, 14, 30);

beforeEach(async () => {
  fake = new FakeServer();
  await fake.start();
  clock = new ManualClock(NOW);
});
afterEach(() => fake.stop());

const client = () =>
  new EsiPublicClient({ clock, userAgent: 'Darkbeacon/test (+http://map.test)', baseUrl: fake.base });

describe('ESI hourly figures', () => {
  it('reads the hour from Last-Modified, the next fetch from Expires, then revalidates with the ETag', async () => {
    const date = new Date(NOW).toUTCString();
    fake.routes.set('/universe/system_kills', (req, res) => {
      if (req.headers['if-none-match'] === '"k1"') return res.writeHead(304, { date }).end();
      json(
        res,
        200,
        [
          { system_id: 30000142, ship_kills: 3, pod_kills: 1, npc_kills: 40 },
          { system_id: 'bad', ship_kills: 1 },
        ],
        {
          etag: '"k1"',
          date,
          'last-modified': new Date(Date.UTC(2026, 9, 12, 14, 2)).toUTCString(),
          expires: new Date(Date.UTC(2026, 9, 12, 15, 2)).toUTCString(),
        },
      );
    });
    const source = new EsiActivitySource(client());
    const first = await source.systemKills();
    expect(first).toEqual({
      ok: true,
      data: {
        hour: Date.UTC(2026, 9, 12, 13),
        rows: [{ systemId: 30000142, shipKills: 3, podKills: 1, npcKills: 40 }],
      },
      nextAt: Date.UTC(2026, 9, 12, 15, 2),
    });
    expect(fake.requests[0]!.headers['user-agent']).toBe('Darkbeacon/test (+http://map.test)');
    expect(fake.requests[0]!.headers['x-compatibility-date']).toBe('2026-08-18');
    const second = await source.systemKills();
    expect(second).toMatchObject({ ok: true, data: null });
    expect(fake.requests[1]!.headers['if-none-match']).toBe('"k1"');
  });

  it('stops asking on a 420 until Retry-After, and backs off on server errors', async () => {
    let calls = 0;
    fake.routes.set('/universe/system_jumps', (_req, res) => {
      calls += 1;
      if (calls === 1) return json(res, 420, { error: 'error limited' }, { 'retry-after': '30' });
      json(res, 503, { error: 'down' });
    });
    const source = new EsiActivitySource(client());
    expect(await source.systemJumps()).toMatchObject({ ok: false, retryAt: NOW + 30_000 });
    // Blocked: no request leaves.
    expect(await source.systemJumps()).toMatchObject({ ok: false, reason: 'rate limited' });
    expect(calls).toBe(1);
    clock.advance(30_000);
    expect(await source.systemJumps()).toMatchObject({ ok: false, retryAt: clock.now() + 5_000 });
    expect(await source.systemJumps()).toMatchObject({ ok: false, retryAt: clock.now() + 10_000 });
  });

  it('rests when the error limit is nearly spent', async () => {
    fake.routes.set('/universe/system_jumps', (_req, res) =>
      json(res, 200, [{ system_id: 30000142, ship_jumps: 7 }], {
        'last-modified': new Date(NOW).toUTCString(),
        'x-esi-error-limit-remain': '5',
        'x-esi-error-limit-reset': '40',
      }),
    );
    const source = new EsiActivitySource(client());
    expect(await source.systemJumps()).toMatchObject({
      ok: true,
      data: { rows: [{ systemId: 30000142, jumps: 7 }] },
    });
    expect(await source.systemJumps()).toMatchObject({ ok: false, retryAt: NOW + 40_000 });
    expect(fake.requests).toHaveLength(1);
  });
});

describe('ESI sovereignty', () => {
  it('reads alliance and faction claims across pages and waits out a 429 for its group', async () => {
    let page1 = 0;
    fake.routes.set('/sovereignty/systems', (req, res) => {
      const page = new URL(req.url!, fake.base).searchParams.get('page');
      if (page === '2')
        return json(res, 200, { solar_systems: [{ solar_system_id: 30000003, claim: { unclaimed: true } }] });
      page1 += 1;
      if (page1 === 2) return json(res, 429, { error: 'slow down' }, { 'retry-after': '90' });
      json(
        res,
        200,
        {
          solar_systems: [
            {
              solar_system_id: 30004759,
              claim: {
                alliance: { alliance_id: 1354830081, corporation_id: 98000001, is_capital_system: false },
              },
            },
            { solar_system_id: 30003135, claim: { faction: { faction_id: 500019 } } },
          ],
        },
        {
          'x-pages': '2',
          'x-ratelimit-group': 'sovereignty',
          'x-ratelimit-limit': '600/15m',
          'x-ratelimit-remaining': '598',
        },
      );
    });
    const source = new EsiSovereigntySource(client());
    expect(await source.claims()).toMatchObject({
      ok: true,
      data: [
        { systemId: 30004759, claim: { kind: 'alliance', allianceId: 1354830081, corporationId: 98000001 } },
        { systemId: 30003135, claim: { kind: 'faction', factionId: 500019 } },
      ],
    });
    expect(await source.claims()).toMatchObject({ ok: false, retryAt: NOW + 90_000 });
    expect(await source.claims()).toMatchObject({ ok: false, reason: 'rate limited' });
    expect(fake.requests.filter((r) => r.url.startsWith('/sovereignty/systems'))).toHaveLength(3);
  });
});

describe('ESI names', () => {
  it('splits a batch ESI refuses for an unknown id and reads tickers', async () => {
    fake.routes.set('/universe/names', (_req, res, body) => {
      const ids = JSON.parse(body) as number[];
      if (ids.includes(13)) return json(res, 404, { error: 'Ensure all IDs are valid' });
      json(
        res,
        200,
        ids.map((id) => ({ id, name: `Name ${id}`, category: id > 99_000_000 ? 'alliance' : 'character' })),
      );
    });
    fake.routes.set('/alliances/99000001', (_req, res) =>
      json(res, 200, { name: 'Test Alliance', ticker: 'TEST' }),
    );
    const resolver = new EsiNameResolver(client());
    const names = await resolver.names([11, 12, 13, 99000001]);
    expect(names.map((n) => n.id).sort()).toEqual([11, 12, 99000001]);
    expect(await resolver.ticker('alliance', 99000001)).toBe('TEST');
    expect(await resolver.ticker('alliance', 99000002)).toBeNull();
  });
});

describe('zKillboard history', () => {
  it('asks for a system with a trailing slash and a user agent, and reads its killmails', async () => {
    fake.routes.set('/api/kills/solarSystemID/31000005/pastSeconds/604800/', (_req, res) => {
      // The API's entries: ESI's killmail fields with zkb next to them.
      const { esi, zkb } = killPackage(1, 31000005);
      json(res, 200, [
        { ...esi, zkb },
        { killmail_id: 2, zkb: { hash: 'x' } },
      ]);
    });
    const history = new ZkillHistory({
      clock,
      userAgent: 'Darkbeacon/test (+http://map.test)',
      baseUrl: fake.base,
    });
    const result = await history.recent(31000005, 7 * 24 * 3600);
    expect(result.ok && result.data.kills.map((k) => k.id)).toEqual([1]);
    expect(result.ok && result.data.capped).toBe(false);
    expect(fake.requests[0]!.headers['user-agent']).toContain('Darkbeacon');
    expect(fake.requests[0]!.headers['accept-encoding']).toContain('gzip');
  });

  it('waits out a 429 and treats an error object as a failure', async () => {
    let calls = 0;
    fake.routes.set('*', (_req, res) => {
      calls += 1;
      if (calls === 1) return json(res, 429, { error: 'slow' }, { 'retry-after': '120' });
      json(res, 200, { error: 'Invalid' });
    });
    const history = new ZkillHistory({ clock, userAgent: 'Darkbeacon/test', baseUrl: fake.base });
    expect(await history.recent(31000005, 3600)).toMatchObject({ ok: false, retryAt: NOW + 120_000 });
    expect(await history.recent(31000005, 3600)).toMatchObject({ ok: false, reason: 'paused' });
    clock.advance(120_000);
    expect(await history.recent(31000005, 3600)).toMatchObject({ ok: false, reason: 'Invalid' });
    expect(calls).toBe(2);
  });
});

describe('R2Z2 feed', () => {
  it('starts from sequence.json, reads one package after another, waits after a 404 and keeps its place', async () => {
    fake.routes.set('/ephemeral/sequence.json', (_req, res) => json(res, 200, { sequence: 100 }));
    fake.routes.set('/ephemeral/100.json', (_req, res) => json(res, 200, killPackage(5, 31000005)));
    fake.routes.set('/ephemeral/101.json', (_req, res) => json(res, 200, killPackage(6, 30000142)));
    const saved: Array<{ sequence: number }> = [];
    const kills: Killmail[] = [];
    const sleeps: number[] = [];
    let alive = 0;
    let stop!: () => void;
    const done = new Promise<void>((resolve) => (stop = resolve));
    const feed = new R2z2KillFeed({
      clock,
      userAgent: 'Darkbeacon/test',
      baseUrl: fake.base,
      load: async () => null,
      save: async (position) => void saved.push(position),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (ms >= 6_000) stop();
      },
    });
    feed.start({
      wanted: async () => true,
      onKill: async (kill) => void kills.push(kill),
      onAlive: () => (alive += 1),
      onError: (error) => {
        throw error;
      },
    });
    await done;
    await feed.stop();
    expect(kills.map((k) => [k.id, k.systemId])).toEqual([
      [5, 31000005],
      [6, 30000142],
    ]);
    expect(saved.map((p) => p.sequence)).toEqual([101, 102]);
    expect(sleeps).toEqual([150, 150, 6_000]);
    expect(fake.requests.map((r) => r.url).slice(0, 4)).toEqual([
      '/ephemeral/sequence.json',
      '/ephemeral/100.json',
      '/ephemeral/101.json',
      '/ephemeral/102.json',
    ]);
    expect(alive).toBeGreaterThanOrEqual(3);
  });
});

describe('killmail packages', () => {
  it('keeps the victim, the final blow and attackers per corporation', () => {
    expect(parseKillPackage(killPackage(7, 31000005))).toEqual({
      id: 7,
      hash: 'hash7',
      systemId: 31000005,
      time: Date.UTC(2026, 9, 12, 13, 55),
      value: 12_500_000,
      npc: false,
      solo: false,
      victim: {
        characterId: 90000001,
        corporationId: 98000001,
        allianceId: 99000001,
        factionId: null,
        shipTypeId: 587,
      },
      finalBlow: {
        characterId: 90000002,
        corporationId: 98000002,
        allianceId: 99000002,
        factionId: null,
        shipTypeId: 11987,
      },
      attackerCount: 3,
      attackers: [{ corporationId: 98000002, allianceId: 99000002, pilots: 2 }],
    });
    expect(parseKillPackage({ killmail_id: 1 })).toBeNull();
  });
});
