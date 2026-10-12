import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { JumpMetaDto, JumpPlanDto, JumpUniverseDto, MeDto } from '@darkbeacon/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

const ARK = 28850;
const AVATAR = 11567;
const ARCHON = 23757;
const JITA = 30000142;
const AMARR = 30002187;
const IGNOITTON = 30002647; // low-sec, 3 gates from Jita
const AMI = 30005035; // low-sec, 3 gates from Amarr
const DQ1 = 30004759; // 1DQ1-A, Delve
const VFK = 30002904; // VFK-IV, Deklein
const KINO = 30001372; // Pochven

/** The jump planner over HTTP, on the committed k-space dataset. */
describeEachDialect('jump planner over HTTP', (t) => {
  let app: NestFastifyApplication;
  let cookie = '';

  const inject = (method: 'GET' | 'POST', url: string, options: { body?: unknown; headers?: object } = {}) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { cookie, ...options.headers },
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      });

  const plan = async (body: object) => {
    const response = await inject('POST', '/api/jumps/plan', { body });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as JumpPlanDto;
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }),
      secretKey: 'x'.repeat(32),
      dataDir: '/nonexistent',
    };
    app = await createApp(config, { database: t.db, logger: false });
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

  it('lists the ships with a jump drive from the SDE', async () => {
    const meta = JSON.parse((await inject('GET', '/api/jumps')).body) as JumpMetaDto;
    expect(meta.source).toMatch(/^SDE build \d+/);
    expect(meta.ships.find((s) => s.name === 'Ark')).toMatchObject({
      hull: 'jump_freighter',
      rangeLy: 5,
      fuelPerLy: 8800,
      isotope: 'helium',
      fatigueMultiplier: 0.1,
      highSec: true,
      cyno: 'industrial',
    });
    expect(meta.ships.find((s) => s.name === 'Avatar')).toMatchObject({
      hull: 'titan',
      rangeLy: 3,
      bridges: true,
    });
    expect(meta.ships.find((s) => s.name === 'Redeemer')).toMatchObject({
      hull: 'black_ops',
      rangeLy: 4,
      cyno: 'covert',
    });
    expect(meta.ships.find((s) => s.name === 'Hubris')).toMatchObject({ hull: 'lancer', rangeLy: 4 });
    expect(new Set(meta.ships.map((s) => s.hull)).size).toBe(10);
    expect(meta.ships.find((s) => s.name === 'Charon')).toBeUndefined(); // freighters have no jump drive
  });

  it('serves the map dataset compressed, versioned and revalidated by ETag', async () => {
    cookie = '';
    expect((await inject('GET', '/api/jumps/universe')).statusCode).toBe(401);
    const response = await inject('POST', '/api/auth/dev', {
      body: { name: 'alice', character: { id: 90000001, name: 'Pilot' } },
    });
    cookie = [response.headers['set-cookie']].flat()[0]!.split(';')[0]!;
    const { version } = JSON.parse((await inject('GET', '/api/jumps')).body) as JumpMetaDto;

    const fresh = await inject('GET', `/api/jumps/universe?v=${version}`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers['content-encoding']).toBe('gzip');
    expect(fresh.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(fresh.rawPayload.length).toBeLessThan(200_000);

    const plain = await inject('GET', '/api/jumps/universe');
    expect(plain.headers['cache-control']).toBe('private, no-cache');
    const data = JSON.parse(plain.body) as JumpUniverseDto;
    expect(data.version).toBe(version);
    expect(data.systems.id.length).toBeGreaterThan(5000);
    expect(data.systems.id).toContain(JITA);
    expect(data.systems.id.some((id) => id >= 31_000_000)).toBe(false); // no wormhole space
    expect(data.gates.length % 2).toBe(0);

    const again = await inject('GET', '/api/jumps/universe', {
      headers: { 'if-none-match': fresh.headers.etag },
    });
    expect(again.statusCode).toBe(304);
  });

  it('plans a jump freighter from Jita-side low-sec to Amarr-side low-sec in a few jumps', async () => {
    const result = await plan({ shipTypeId: ARK, origin: IGNOITTON, destination: AMI });
    expect(result.rangeLy).toBe(10); // Jump Drive Calibration V by default
    expect(result.route).not.toBeNull();
    const route = result.route!;
    expect(route.jumps).toBeGreaterThanOrEqual(2);
    expect(route.jumps).toBeLessThanOrEqual(3);
    expect(route.gates).toBe(0);
    for (const leg of route.legs) {
      expect(leg.ly).toBeLessThanOrEqual(10);
      expect(leg.to.security).toBeLessThan(0.45);
    }
    // 8800 per ly at JFC IV and Jump Freighters IV: 0.36 of it.
    expect(route.fuel).toBeGreaterThanOrEqual(Math.floor(route.ly * 8800 * 0.36));
    expect(route.fuel).toBeLessThanOrEqual(Math.ceil(route.ly * 8800 * 0.36) + route.jumps);
    expect(route.fatigueMinutes).toBeLessThan(120);
  });

  it('finishes a jump freighter trip into Amarr over stargates', async () => {
    const route = (await plan({ shipTypeId: ARK, origin: JITA, destination: AMARR })).route!;
    expect(route.legs[route.legs.length - 1]!.to.name).toBe('Amarr');
    expect(route.jumps).toBeLessThanOrEqual(3);
    expect(route.gates).toBeGreaterThan(0);
    const kinds = route.legs.map((l) => l.kind);
    expect(kinds.indexOf('gate')).toBe(route.jumps); // gates only after the last jump
    const never = await plan({ shipTypeId: ARK, origin: JITA, destination: AMARR, gates: 'never' });
    expect(never.route).toBeNull();
    expect(never.problem?.code).toBe('no_route');
  });

  it('keeps capitals out of high-sec and Pochven', async () => {
    expect((await plan({ shipTypeId: ARCHON, origin: JITA, destination: AMI })).problem?.code).toBe(
      'origin_not_allowed',
    );
    expect((await plan({ shipTypeId: ARCHON, origin: IGNOITTON, destination: AMARR })).problem?.code).toBe(
      'destination_not_allowed',
    );
    expect((await plan({ shipTypeId: ARCHON, origin: IGNOITTON, destination: KINO })).problem?.code).toBe(
      'no_route',
    );
  });

  it('plans a titan across null-sec within its range', async () => {
    const result = await plan({ shipTypeId: AVATAR, origin: DQ1, destination: VFK, bridgeTonnes: 100_000 });
    expect(result.rangeLy).toBe(6);
    const route = result.route!;
    // 59.7 ly at 6 ly per jump: at least 10 jumps.
    expect(route.jumps).toBeGreaterThanOrEqual(10);
    expect(route.jumps).toBeLessThanOrEqual(13);
    expect(route.legs.every((l) => l.ly <= 6 && l.to.security < 0.45)).toBe(true);
    expect(route.fatigueMinutes).toBe(300); // a titan hits the 5 hour cap
    expect(route.legs.every((l) => l.activationMinutes <= 30)).toBe(true);
    expect(route.bridgeFuel).toBeGreaterThan(0);
  });

  it('refuses ships without a jump drive and systems outside known space', async () => {
    expect(
      (
        await inject('POST', '/api/jumps/plan', {
          body: { shipTypeId: 20185, origin: JITA, destination: AMI },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await inject('POST', '/api/jumps/plan', {
          body: { shipTypeId: ARK, origin: 31000005, destination: AMI },
        })
      ).statusCode,
    ).toBe(400);
  });
});
