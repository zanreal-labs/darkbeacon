import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { ManualClock, type EventLog, type MapRole } from '@wormwright/core';
import { describeEachDialect } from '@wormwright/db/testing';
import type { MapScope } from '@wormwright/shared';
import {
  TrackingPoller,
  type AutoMapTarget,
  type RecordedJump,
  type TrackingRepository,
} from '@wormwright/tracking';
import { fakeAccess, fakeCharacters, FakeEsi } from '@wormwright/tracking/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';
import { AUTO_MAP_TARGET, CHARACTER_TOKENS, EVENT_LOG, MAP_ACCESS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { TRACKING_REPOSITORY } from './tracking.module.js';

const PILOT = 90000001;
const ALT = 90000002;
const JITA = 30000142;
const PERIMETER = 30000144;
const J_SPACE = 31000007; // J105443, C1

describeEachDialect('tracking and universe over HTTP', (t) => {
  let app: NestFastifyApplication;
  let recorded: RecordedJump[];
  let scopes: MapScope[];
  let roles: Record<string, Record<string, MapRole>>;

  const request = async (method: 'GET' | 'PUT', url: string, as?: string, body?: unknown) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: as ? { authorization: `Bearer ${as}` } : {},
        ...(body === undefined ? {} : { payload: body as object }),
      });
    return {
      status: response.statusCode,
      body: response.body ? (JSON.parse(response.body) as unknown) : null,
    };
  };

  beforeEach(async () => {
    recorded = [];
    scopes = ['wormhole'];
    roles = { m1: { alice: 'member', bob: 'viewer' } };
    const target: AutoMapTarget = {
      scopes: (mapId) => Promise.resolve(mapId === 'm1' ? scopes : null),
      recordJump: (jump) => {
        recorded.push(jump);
        return Promise.resolve();
      },
    };

    // Stand-ins for the identity, access and mapping modules.
    @Global()
    @Module({
      providers: [
        {
          provide: CHARACTER_TOKENS,
          useValue: fakeCharacters({
            [PILOT]: { name: 'Pilot', accountId: 'alice' },
            [ALT]: { name: 'Alt', accountId: 'bob' },
          }),
        },
        { provide: MAP_ACCESS, useValue: fakeAccess(roles) },
        { provide: AUTO_MAP_TARGET, useValue: target },
      ],
      exports: [CHARACTER_TOKENS, MAP_ACCESS, AUTO_MAP_TARGET],
    })
    class FakePorts {}

    @Module({})
    class TestRoot {}

    const config = { ...parseEnv({ NODE_ENV: 'test' }), secretKey: 'x'.repeat(32) };
    app = await NestFactory.create<NestFastifyApplication>(
      { module: TestRoot, imports: [AppModule.forRoot(config, { database: t.db }), FakePorts] },
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api');
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    app
      .get(ActorResolverRegistry)
      .use(async (req) =>
        typeof req.headers.authorization === 'string'
          ? { kind: 'account', id: req.headers.authorization.slice(7), instanceRole: 'user' }
          : null,
      );
  });

  afterEach(async () => {
    await app.close();
  });

  it('searches and reads solar systems', async () => {
    expect((await request('GET', '/api/universe/systems?q=jita')).status).toBe(401);

    const search = await request('GET', '/api/universe/systems?q=jita', 'alice');
    expect(search.status).toBe(200);
    expect(search.body).toEqual([
      {
        id: JITA,
        name: 'Jita',
        regionName: 'The Forge',
        constellationName: 'Kimotoro',
        security: expect.any(Number) as number,
        whClass: 7,
      },
    ]);
    expect((await request('GET', '/api/universe/systems?q=a&limit=3', 'alice')).body).toHaveLength(3);
    expect((await request('GET', '/api/universe/systems?q=a', 'alice')).body).toHaveLength(20);

    expect((await request('GET', `/api/universe/systems/${JITA}`, 'alice')).body).toEqual({
      id: JITA,
      name: 'Jita',
      regionName: 'The Forge',
      constellationName: 'Kimotoro',
      security: expect.any(Number) as number,
      whClass: 7,
    });

    expect((await request('GET', `/api/universe/systems/${J_SPACE}`, 'alice')).body).toMatchObject({
      name: 'J105443',
      whClass: 1,
    });
    expect((await request('GET', '/api/universe/systems/1', 'alice')).status).toBe(404);
    expect((await request('GET', '/api/universe/systems/abc', 'alice')).status).toBe(400);
    expect((await request('GET', '/api/universe/systems?q=', 'alice')).status).toBe(400);
  });

  it('tracks a character, polls ESI and auto-maps its jumps', async () => {
    const track = (as: string, characterId: number, tracked: boolean) =>
      request('PUT', '/api/maps/m1/tracking', as, { characterId, tracked });

    expect((await track('alice', PILOT, true)).status).toBe(204);
    expect((await track('bob', ALT, true)).status).toBe(403);
    expect((await track('alice', ALT, true)).status).toBe(404);
    expect((await request('PUT', '/api/maps/m1/tracking', 'alice', { characterId: 'x' })).status).toBe(400);

    const listed = await request('GET', '/api/maps/m1/characters', 'bob');
    expect(listed.body).toEqual([
      expect.objectContaining({ characterId: PILOT, name: 'Pilot', online: false }),
    ]);
    expect((await request('GET', '/api/maps/m2/characters', 'bob')).status).toBe(404);

    // Drive a poller over the app's repository and event log with a fake ESI and a manual clock.
    const clock = new ManualClock();
    const esi = new FakeEsi(5_000, () => clock.now());
    const log = app.get<EventLog>(EVENT_LOG);
    const poller = new TrackingPoller({
      tracking: app.get<TrackingRepository>(TRACKING_REPOSITORY),
      characters: fakeCharacters({ [PILOT]: { name: 'Pilot', accountId: 'alice' } }),
      esi,
      events: log,
      uow: t.db,
      clock,
    });
    esi.set(PILOT, { online: true, location: J_SPACE, ship: 11132, shipName: 'Probe' });
    await poller.tick();
    esi.set(PILOT, { location: JITA });
    clock.advance(5_000);
    await poller.tick();

    expect((await log.readSince('map:m1', 0)).map((e) => e.type)).toEqual([
      'character.tracked',
      'character.online_changed',
      'character.ship_changed',
      'character.moved',
      'character.moved',
      'character.jumped',
    ]);
    await vi.waitFor(() =>
      expect(recorded).toEqual([
        {
          mapId: 'm1',
          from: J_SPACE,
          to: JITA,
          type: 'wormhole',
          characterId: PILOT,
          shipTypeId: 11132,
          accountId: 'alice',
        },
      ]),
    );

    // With high-sec in scope a gate jump is mapped as a gate.
    scopes = ['wormhole', 'high'];
    esi.set(PILOT, { location: PERIMETER });
    clock.advance(5_000);
    await poller.tick();
    await vi.waitFor(() =>
      expect(recorded.at(-1)).toMatchObject({ from: JITA, to: PERIMETER, type: 'gate' }),
    );

    const [snapshot] = app.get(RealtimeRegistry).snapshotProviders('map');
    expect(await snapshot!('m1', null)).toEqual({
      characters: [expect.objectContaining({ characterId: PILOT, solarSystemId: PERIMETER, online: true })],
    });

    expect((await track('alice', PILOT, false)).status).toBe(204);
    expect((await request('GET', '/api/maps/m1/characters', 'alice')).body).toEqual([]);
  });
});
