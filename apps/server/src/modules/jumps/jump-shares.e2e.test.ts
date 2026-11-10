import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { JumpShareCreatedDto, JumpShareViewDto, MeDto } from '@darkbeacon/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FetchLike } from '../../adapters/identity/oauth-http.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const ARK = 28850;
const IGNOITTON = 30002647;
const AMI = 30005035;
const DQ1 = 30004759;
const JITA_STATION = 60003760;

/** Shared jump routes over HTTP: shared by a signed-in pilot, read by anyone with the link. */
describeEachDialect('shared jump routes over HTTP', (t) => {
  let app: NestFastifyApplication;
  let cookie = '';

  /** ESI's market: helium at 700 ISK in Jita, nothing else is asked for. */
  const esi: FetchLike = async (url) => {
    const u = new URL(url);
    if (u.host === 'esi.evetech.net' && /^\/markets\/\d+\/orders$/.test(u.pathname))
      return Response.json([{ location_id: JITA_STATION, price: 700 }], { headers: { 'x-pages': '1' } });
    return new Response('not here', { status: 404 });
  };

  const inject = (
    method: 'GET' | 'POST',
    url: string,
    options: { body?: unknown; signedIn?: boolean } = {},
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: options.signedIn === false ? {} : { cookie },
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      });

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }),
      secretKey: 'x'.repeat(32),
      dataDir: '/nonexistent',
    };
    app = await createApp(config, { database: t.db, logger: false, fetch: esi });
    await app.getHttpAdapter().getInstance().ready();
    cookie = '';
    const response = await inject('POST', '/api/auth/dev', {
      body: { name: 'alice', character: { id: 90000001, name: 'Pilot' } },
    });
    expect((JSON.parse(response.body) as MeDto).account).toBeTruthy();
    cookie = [response.headers['set-cookie']].flat()[0]!.split(';')[0]!;
  });

  afterEach(async () => {
    await app.close();
  });

  it('shares a route with stops that anyone can open without signing in', async () => {
    const shared = await inject('POST', '/api/jumps/shares', {
      body: {
        plan: {
          shipTypeId: ARK,
          origin: IGNOITTON,
          destination: AMI,
          via: [DQ1],
          skills: { jdc: 4, jfc: 5, jf: 5 },
        },
        fuelHub: 'jita',
      },
    });
    expect(shared.statusCode).toBe(200);
    const { token } = JSON.parse(shared.body) as JumpShareCreatedDto;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const visit = await inject('GET', `/api/public/jumps/${token}`, { signedIn: false });
    expect(visit.statusCode).toBe(200);
    expect(visit.headers['referrer-policy']).toBe('no-referrer');
    const view = JSON.parse(visit.body) as JumpShareViewDto;
    expect(view.request).toMatchObject({
      origin: IGNOITTON,
      destination: AMI,
      via: [DQ1],
      skills: { jdc: 4 },
    });
    expect(view.plan.route?.legs.some((l) => l.stop && l.to.id === DQ1)).toBe(true);
    expect(view.fuelPrices?.prices.helium).toBe(700);
    // Nothing about who shared it.
    expect(visit.body).not.toMatch(/alice|Pilot|90000001/);

    const map = await inject('GET', `/api/public/jumps/universe?v=${view.universeVersion}`, {
      signedIn: false,
    });
    expect(map.statusCode).toBe(200);
    expect(map.headers['cache-control']).toMatch(/immutable/);
  });

  it('answers 404 for a token nobody shared, and lets only accounts share', async () => {
    expect(
      (await inject('GET', '/api/public/jumps/AAAAAAAAAAAAAAAAAAAAAA', { signedIn: false })).statusCode,
    ).toBe(404);
    expect((await inject('GET', '/api/public/jumps/x', { signedIn: false })).statusCode).toBe(404);
    const anonymous = await inject('POST', '/api/jumps/shares', {
      signedIn: false,
      body: { plan: { shipTypeId: ARK, origin: IGNOITTON, destination: AMI } },
    });
    expect(anonymous.statusCode).toBe(401);
    const unknown = await inject('POST', '/api/jumps/shares', {
      body: { plan: { shipTypeId: ARK, origin: IGNOITTON, destination: 30099999 } },
    });
    expect(unknown.statusCode).toBe(400);
  });
});
