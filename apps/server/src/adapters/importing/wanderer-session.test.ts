import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseWandererBase, SourceError, type WandererSessionRequest } from '@darkbeacon/importing';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { parseLivePage, sessionCookie, WandererSessionSource, wandererTime } from './wanderer-session.js';

const COOKIE = 'SFMyNTY.g3QAAAACbQAAAAtfY3NyZl90b2tlbg.signature-part';
const VERSION = '1.90.0';

const PAGE = `<!DOCTYPE html><html><head>
<meta name="csrf-token" content="csrf-abc">
</head><body data-version="${VERSION}">
<div id="phx-F1" data-phx-main data-phx-session="sess.tok&amp;en" data-phx-static="stat.token"></div>
</body></html>`;

const INIT = {
  systems: [
    {
      id: '31000138',
      name: 'Home',
      position: { x: 10, y: 20 },
      status: 0,
      labels: null,
      locked: true,
      visible: true,
      tag: 'A',
      temporary_name: null,
      description: 'static C5',
    },
    { id: '30003436', name: 'Amarr', position: { x: 300, y: 20 }, status: 0, visible: true },
  ],
  system_static_infos: [
    { solar_system_id: 31000138, solar_system_name: 'J123456' },
    { solar_system_id: 30003436, solar_system_name: 'Amarr' },
  ],
  connections: [
    {
      id: '31000138_30003436',
      source: '31000138',
      target: '30003436',
      mass_status: 1,
      time_status: 5,
      type: 0,
      ship_size_type: 2,
      locked: false,
    },
  ],
  hubs: ['30000142'],
};

const SIGNATURES: Record<string, unknown[]> = {
  '31000138': [
    {
      eve_id: 'ABC-123',
      kind: 'Cosmic Signature',
      group: 'Wormhole',
      type: 'K162',
      name: 'Amarr',
      linked_system: { solar_system_id: 30003436 },
      inserted_at: '2026/11/21 18:54:23',
      updated_at: '2026/11/21 18:54:23',
    },
    { eve_id: 'GONE-1', group: 'Combat Site', deleted: true },
  ],
};

interface FakeOptions {
  /** Answer the page with a redirect (signed out). */
  signedOut?: boolean;
  /** Push `init` only when `ui_loaded` carries the page's version. */
  checkVersion?: boolean;
}

interface Fake {
  base: string;
  seen: { cookie?: string; origin?: string; join?: Record<string, unknown>; uiLoaded?: unknown };
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

/** A Wanderer with one map page and the LiveView socket behind it (protocol vsn 2.0.0). */
async function fakeWanderer(options: FakeOptions = {}): Promise<Fake> {
  const seen: Fake['seen'] = {};
  const server = createServer((req, res) => {
    if (options.signedOut || req.headers.cookie !== `_wanderer_app_key=${COOKIE}`) {
      res.writeHead(302, { location: '/welcome' }).end();
      return;
    }
    if (req.url !== '/onlyholes') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    seen.cookie = req.headers.cookie;
    seen.origin = req.headers.origin;
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => {
        const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw)) as [
          string | null,
          string,
          string,
          string,
          Record<string, unknown>,
        ];
        const send = (message: unknown[]) => ws.send(JSON.stringify(message));
        if (event === 'phx_join') {
          seen.join = payload;
          send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { rendered: { 0: '' } } }]);
        } else if (event === 'event' && payload.event === 'ui_loaded') {
          seen.uiLoaded = payload.value;
          const version = (payload.value as { version?: string }).version;
          if (!options.checkVersion || version === VERSION)
            send([joinRef, null, topic, 'diff', { e: [['map_event', { type: 'init', body: INIT }]] }]);
        } else if (event === 'event' && payload.event === 'get_signatures') {
          const id = (payload.value as { system_id: string }).system_id;
          send([
            joinRef,
            ref,
            topic,
            'phx_reply',
            { status: 'ok', response: { diff: { r: { signatures: SIGNATURES[id] ?? [] } } } },
          ]);
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function request(base: string, cookie = COOKIE): WandererSessionRequest {
  return {
    kind: 'wanderer-session',
    base: parseWandererBase(base, { allowPlainHttp: true }),
    slug: 'onlyholes',
    cookie,
    insecureTls: false,
    allowPrivate: true,
  };
}

const source = () => new WandererSessionSource({ mapTimeoutMs: 2_000, replyTimeoutMs: 2_000 });

describe('WandererSessionSource', () => {
  it('reads the shown map over the live connection, as the signed-in account', async () => {
    const fake = await fakeWanderer({ checkVersion: true });
    const dump = await source().read(request(fake.base));

    expect(fake.seen.cookie).toBe(`_wanderer_app_key=${COOKIE}`);
    expect(fake.seen.origin).toBe(fake.base);
    expect(fake.seen.join).toMatchObject({
      session: 'sess.tok&en',
      static: 'stat.token',
      url: `${fake.base}/onlyholes`,
      params: { _csrf_token: 'csrf-abc' },
    });
    expect(fake.seen.uiLoaded).toEqual({ version: VERSION });

    expect(dump.source).toEqual({
      kind: 'wanderer-session',
      host: new URL(fake.base).host,
      slug: 'onlyholes',
      name: 'onlyholes',
    });
    expect(dump.systems).toHaveLength(2);
    expect(dump.systems[0]).toMatchObject({
      solarSystemId: 31000138,
      customName: 'Home',
      tag: 'A',
      locked: true,
      position: { x: 10, y: 20 },
      description: 'static C5',
    });
    expect(dump.systems[1]).toMatchObject({ solarSystemId: 30003436, customName: null });
    expect(dump.connections).toEqual([
      expect.objectContaining({
        source: 31000138,
        target: 30003436,
        massStatus: 1,
        timeStatus: 5,
        shipSizeType: 2,
      }),
    ]);
    expect(dump.hubs).toEqual([30000142]);
    expect(dump.signatures).toEqual([
      expect.objectContaining({
        solarSystemId: 31000138,
        eveId: 'ABC-123',
        group: 'Wormhole',
        type: 'K162',
        linkedSystemId: 30003436,
        insertedAt: Date.parse('2026-11-21T18:54:23Z'),
      }),
    ]);
    expect(dump.warnings.join(' ')).toMatch(/only what the map shows/);
  });

  it('tests the connection by counting the shown systems', async () => {
    const fake = await fakeWanderer();
    await expect(source().test(request(fake.base))).resolves.toEqual({
      systems: 2,
      hiddenSystems: null,
      name: 'onlyholes',
    });
  });

  it('says the cookie expired when Wanderer sends the page to sign in', async () => {
    const fake = await fakeWanderer({ signedOut: true });
    const failure = await source()
      .read(request(fake.base))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SourceError);
    expect(failure).toMatchObject({ failure: 'auth' });
    expect((failure as Error).message).toMatch(/expired or was signed out/);
  });
});

describe('parseLivePage', () => {
  it('takes the tokens of the main live view and the app version', () => {
    expect(parseLivePage(PAGE, 'c')).toEqual({
      csrfToken: 'csrf-abc',
      viewId: 'phx-F1',
      session: 'sess.tok&en',
      static: 'stat.token',
      version: VERSION,
      cookie: 'c',
    });
  });

  it('is null for a page without a live view (the welcome page)', () => {
    expect(parseLivePage('<html><meta name="csrf-token" content="x"></html>', 'c')).toBeNull();
  });
});

describe('sessionCookie', () => {
  it('accepts the value, name=value, or a whole Cookie header', () => {
    expect(sessionCookie(COOKIE)).toBe(COOKIE);
    expect(sessionCookie(`_wanderer_app_key=${COOKIE}`)).toBe(COOKIE);
    expect(sessionCookie(`Cookie: other=1; _wanderer_app_key=${COOKIE}; x=2`)).toBe(COOKIE);
  });

  it('refuses what is not a cookie', () => {
    expect(() => sessionCookie('not a cookie at all, has spaces')).toThrow(SourceError);
  });
});

describe('wandererTime', () => {
  it('reads Wanderer signature times as UTC', () => {
    expect(wandererTime('2026/11/21 18:54:23')).toBe('2026-11-21T18:54:23Z');
  });
});
