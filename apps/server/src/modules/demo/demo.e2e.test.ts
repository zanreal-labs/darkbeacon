import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@wormwright/db/testing';
import type { AuthProvidersDto, MapSnapshot, MapSummaryDto, MeDto, SignatureDto } from '@wormwright/shared';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';

describeEachDialect('demo mode over HTTP', (t) => {
  let app: NestFastifyApplication;

  const start = async (env: Record<string, string>) => {
    const config = { ...parseEnv({ NODE_ENV: 'test', ...env }), secretKey: 'x'.repeat(32) };
    app = await createApp(config, { database: t.db, logger: false, webDist: '/nonexistent' });
    await app.getHttpAdapter().getInstance().ready();
  };

  const request = async (method: 'GET' | 'POST', url: string, cookie?: string) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, headers: cookie ? { cookie } : {} });
    const setCookie = [response.headers['set-cookie'] ?? []].flat()[0];
    return {
      status: response.statusCode,
      body: response.body ? (JSON.parse(response.body) as unknown) : null,
      cookie: setCookie?.split(';')[0],
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
    expect(maps).toEqual([expect.objectContaining({ name: 'Demo chain', role: 'admin' })]);

    const parts = app.get(RealtimeRegistry).snapshotProviders('map');
    const snapshot = {} as Required<MapSnapshot>;
    for (const part of parts) Object.assign(snapshot, await part(maps[0]!.id, { kind: 'plugin', id: 't' }));
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

    // A second visit gets a new session for the same account and no second map.
    const second = await request('POST', '/api/auth/demo');
    expect((second.body as MeDto).account.id).toBe(me.account.id);
    expect(second.cookie).not.toBe(first.cookie);
    expect((await request('GET', '/api/maps', second.cookie)).body).toHaveLength(1);
  });

  it('is not there without demo mode', async () => {
    await start({});
    expect((await request('GET', '/api/auth/providers')).body).toMatchObject({ demo: false });
    expect((await request('POST', '/api/auth/demo')).status).toBe(404);
  });
});
