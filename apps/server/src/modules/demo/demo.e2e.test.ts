import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuthProvidersDto,
  MapSnapshot,
  MapSummaryDto,
  MeDto,
  PassageDto,
  SignatureDto,
  StreamSnapshotDto,
} from '@darkbeacon/shared';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';

describeEachDialect('demo mode over HTTP', (t) => {
  let app: NestFastifyApplication;

  const start = async (env: Record<string, string>) => {
    const config = { ...parseEnv({ NODE_ENV: 'test', ...env }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false });
    await app.getHttpAdapter().getInstance().ready();
  };

  const request = async (method: 'GET' | 'POST', url: string, cookie?: string) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, headers: cookie ? { cookie } : {} });
    const setCookies = [response.headers['set-cookie'] ?? []].flat();
    return {
      status: response.statusCode,
      body: response.body ? (JSON.parse(response.body) as unknown) : null,
      cookie: setCookies[0]?.split(';')[0],
      cookies: setCookies,
    };
  };

  afterEach(async () => {
    await app.close();
  });

  it('signs a visit in as the demo account and seeds the demo map once', async () => {
    await start({ DEMO_MODE: 'true' });
    expect((await request('GET', '/api/auth/providers')).body).toMatchObject({
      demo: true,
    } satisfies Partial<AuthProvidersDto>);

    const first = await request('POST', '/api/auth/demo');
    expect(first.status).toBe(200);
    const me = first.body as MeDto;
    expect(me.account).toMatchObject({ name: 'Demo pilot', instanceRole: 'owner' });
    expect(me.characters).toHaveLength(2);
    expect(me.characters.map((c) => c.id)).toContain(me.account.mainCharacterId);

    const maps = (await request('GET', '/api/maps', first.cookie)).body as MapSummaryDto[];
    expect(maps.map((m) => [m.name, m.role, m.kind ?? 'standard'])).toEqual([
      ['Alliance chain', 'admin', 'composite'],
      ['Corp A chain', 'admin', 'standard'],
      ['Corp B chain', 'admin', 'standard'],
      ['Demo chain', 'admin', 'standard'],
    ]);
    const demo = maps.find((m) => m.name === 'Demo chain')!;

    const parts = app.get(RealtimeRegistry).snapshotProviders('map');
    const snapshot = {} as Required<MapSnapshot>;
    for (const part of parts) Object.assign(snapshot, await part(demo.id, { kind: 'plugin', id: 't' }));
    expect(snapshot.systems).toHaveLength(8);
    expect(snapshot.map.labels.map((l) => l.name)).toEqual(['Staging', 'Sites', 'Hostile', 'Exit']);
    const c = snapshot.connections;
    expect(c).toHaveLength(7);
    expect(c.some((x) => x.timeStatus === 'eol')).toBe(true);
    expect(c.some((x) => x.massStatus === 'critical' && x.dangerous)).toBe(true);
    expect(c.some((x) => x.massStatus === 'reduced')).toBe(true);
    expect(c.some((x) => x.shipSize === 'small' && x.bubbled === 'target')).toBe(true);
    expect(c.some((x) => x.type === 'gate')).toBe(true);
    const signatures = snapshot.signatures as SignatureDto[];
    expect(signatures.filter((s) => s.connectionId !== null).length).toBeGreaterThanOrEqual(5);

    // A rolling crew's jumps, logged by hand: a Megathron and an Orca through the high-sec static.
    const d845 = c.find((x) => x.source === 31002531 && x.target === 30001376)!;
    const passages = (
      await request('GET', `/api/maps/${demo.id}/connections/${d845.id}/passages`, first.cookie)
    ).body as PassageDto[];
    expect(passages.map((p) => [p.shipName, p.massMode, p.source])).toEqual([
      ['Orca', 'hot', 'manual'],
      ['Orca', 'cold', 'manual'],
      ['Megathron', 'hot', 'manual'],
      ['Megathron', 'cold', 'manual'],
    ]);

    // The alliance chain merges both corporations' maps: one node per system, the later mass wins.
    const alliance = {} as Required<MapSnapshot>;
    const allianceId = maps.find((m) => m.name === 'Alliance chain')!.id;
    for (const part of parts) Object.assign(alliance, await part(allianceId, { kind: 'plugin', id: 't' }));
    expect(alliance.sources.map((s) => s.name)).toEqual(['Alliance chain', 'Corp A chain', 'Corp B chain']);
    const ids = alliance.systems.map((s) => s.solarSystemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
    const overlap = alliance.connections.find(
      (x) => [x.source, x.target].sort().join() === [31000399, 31001924].sort().join(),
    )!;
    expect(overlap).toMatchObject({ massStatus: 'critical', provenance: { writable: true } });
    expect(overlap.provenance!.sources).toHaveLength(2);

    // A second visit gets a new session for the same account and no second set of maps.
    const second = await request('POST', '/api/auth/demo');
    expect((second.body as MeDto).account.id).toBe(me.account.id);
    expect(second.cookie).not.toBe(first.cookie);
    expect((await request('GET', '/api/maps', second.cookie)).body).toHaveLength(4);
    // `/` still opens the demo chain.
    expect((await request('GET', '/api/accounts/me/landing', second.cookie)).body).toMatchObject({
      slug: 'demo-chain',
    });
  });

  it('serves a map snapshot over REST to whoever may follow the stream', async () => {
    await start({ DEMO_MODE: 'true' });
    const { cookie } = await request('POST', '/api/auth/demo');
    const map = ((await request('GET', '/api/maps', cookie)).body as MapSummaryDto[]).find(
      (m) => m.name === 'Demo chain',
    );
    const path = `/api/streams/${encodeURIComponent(`map:${map!.id}`)}/snapshot`;

    const snapshot = await request('GET', path, cookie);
    expect(snapshot.status).toBe(200);
    const body = snapshot.body as StreamSnapshotDto;
    expect(body.stream).toBe(`map:${map!.id}`);
    expect(body.seq).toBeGreaterThan(0);
    expect((body.data as MapSnapshot).systems).toHaveLength(8);
    expect((body.data as MapSnapshot).map?.id).toBe(map!.id);

    expect((await request('GET', path)).status).toBe(401);
    const stranger = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'POST', url: '/api/auth/dev', payload: { name: 'Stranger' } });
    const strangerCookie = [stranger.headers['set-cookie']].flat()[0]!.split(';')[0];
    expect((await request('GET', path, strangerCookie)).status).toBe(404);
    expect((await request('GET', '/api/streams/nope:1/snapshot', cookie)).status).toBe(404);
  });

  it('remembers a sign-out until the next demo sign-in', async () => {
    await start({ DEMO_MODE: 'true' });
    const { cookie } = await request('POST', '/api/auth/demo');
    const out = await request('POST', '/api/auth/logout', cookie);
    expect(out.cookies.some((c) => c.startsWith('dbk_demo_out=1;'))).toBe(true);
    const back = await request('POST', '/api/auth/demo');
    expect(back.cookies.some((c) => c.startsWith('dbk_demo_out=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it("starts a new browser with the account's theme, so it paints before any script asks", async () => {
    await start({ DEMO_MODE: 'true' });
    const theme = (cookies: string[]) => cookies.find((c) => c.startsWith('dbk_theme='));
    const { cookie, cookies } = await request('POST', '/api/auth/demo');
    // Nothing chosen and the instance follows the system: no cookie, CSS decides.
    expect(theme(cookies)).toBeUndefined();

    const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
    const picked = await inject({
      method: 'PUT',
      url: '/api/accounts/me/theme',
      headers: { cookie: cookie! },
      payload: { themeId: 'dark' },
    });
    expect(picked.statusCode).toBe(200);
    const pickedCookie = [picked.headers['set-cookie']].flat()[0]!;
    expect(pickedCookie).toMatch(/^dbk_theme=dark; Path=\/; Max-Age=31536000; SameSite=Lax$/);

    const fresh = await request('POST', '/api/auth/demo');
    expect(theme(fresh.cookies)).toMatch(/^dbk_theme=dark;/);
    expect(theme(fresh.cookies)).not.toContain('HttpOnly');
  });

  it('is not there without demo mode', async () => {
    await start({});
    expect((await request('GET', '/api/auth/providers')).body).toMatchObject({ demo: false });
    expect((await request('POST', '/api/auth/demo')).status).toBe(404);
  });
});
