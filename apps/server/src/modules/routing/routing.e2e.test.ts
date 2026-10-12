import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManualClock, type EventLog, type MapAccess } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CharacterService } from '@darkbeacon/identity';
import type {
  ConnectionDto,
  ConnectionIntelDto,
  HubDistanceDto,
  HubDto,
  MapDto,
  MapExitsDto,
  MapSnapshot,
  MeDto,
  RouteDto,
  StreamSnapshotDto,
  WormholeCatalogDto,
} from '@darkbeacon/shared';
import { TrackingPoller, type TrackingRepository } from '@darkbeacon/tracking';
import { FakeEsi } from '@darkbeacon/tracking/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { CHARACTER_TOKENS, EVENT_LOG, MAP_ACCESS } from '../../platform/tokens.js';
import { TRACKING_REPOSITORY } from '../tracking/tracking.module.js';

const PILOT = 90000001;
const JITA = 30000142;
const TAMA = 30002813;
const AMAMAKE = 30002537;
const HOME = 31002531; // J014348, C3: D845 (HS), U210 (LS)
const RIFTER = 587;

/** Routing, exits, hubs and the connections panel over HTTP, with the real modules behind them. */
describeEachDialect('routing and connections over HTTP', (t) => {
  let app: NestFastifyApplication;
  const cookies = new Map<string, string>();
  let mapId: string;

  const request = async <T = unknown>(
    method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    as?: string,
    body?: unknown,
  ) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: as ? { cookie: cookies.get(as)! } : {},
        ...(body === undefined ? {} : { payload: body as object }),
      });
    return {
      status: response.statusCode,
      body: (response.body ? JSON.parse(response.body) : null) as T,
      cookie: response.headers['set-cookie'],
    };
  };

  const signIn = async (name: string, character: { id: number; name: string }) => {
    const response = await request<MeDto>('POST', '/api/auth/dev', undefined, { name, character });
    cookies.set(name, [response.cookie].flat()[0]!.split(';')[0]!);
    return response.body;
  };

  const events = async (type: string) =>
    (await app.get<EventLog>(EVENT_LOG).readSince(`map:${mapId}`, 0)).filter((e) => e.type === type);

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }),
      secretKey: 'x'.repeat(32),
      dataDir: '/nonexistent',
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.getHttpAdapter().getInstance().ready();
    await signIn('alice', { id: PILOT, name: 'Pilot' });
    await signIn('bob', { id: 90000002, name: 'Alt' });
    mapId = (await request<MapDto>('POST', '/api/maps', 'alice', { name: 'Chain' })).body.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves wormhole types and hull classes', async () => {
    expect((await request('GET', '/api/universe/wormholes')).status).toBe(401);
    const { body } = await request<WormholeCatalogDto>('GET', '/api/universe/wormholes', 'alice');
    expect(body.types.length).toBeGreaterThan(90);
    expect(body.types.find((w) => w.code === 'D845')).toMatchObject({ destination: 'hs', lifetimeHours: 24 });
    expect(body.hullClasses[0]).toMatchObject({ id: 'frigate', name: 'Frigates' });
    expect(
      (await request<{ statics: string[] }>('GET', `/api/universe/systems/${HOME}`, 'alice')).body,
    ).toMatchObject({
      statics: ['D845', 'U210'],
      effect: 'redGiant',
      whClass: 3,
    });
  });

  it('routes, lists exits and publishes them when the chain changes', async () => {
    for (const id of [HOME, TAMA]) {
      expect(
        (await request('POST', `/api/maps/${mapId}/systems`, 'alice', { solarSystemId: id })).status,
      ).toBe(201);
    }
    const link = await request<ConnectionDto>('POST', `/api/maps/${mapId}/connections`, 'alice', {
      source: HOME,
      target: TAMA,
    });
    expect(link.status).toBe(201);

    const route = await request<RouteDto>(
      'GET',
      `/api/maps/${mapId}/route?from=${HOME}&to=${JITA}&mode=safer&skip=frigate,eol&avoid=${AMAMAKE}`,
      'alice',
    );
    expect(route.status).toBe(200);
    expect(route.body.steps[1]).toMatchObject({ name: 'Tama', via: 'wormhole', connectionId: link.body.id });
    expect(route.body.steps.at(-1)?.name).toBe('Jita');
    expect(
      (await request('GET', `/api/maps/${mapId}/route?from=${HOME}&to=${JITA}&mode=fast`, 'alice')).status,
    ).toBe(400);
    expect((await request('GET', `/api/maps/${mapId}/route?from=${HOME}&to=${JITA}`, 'bob')).status).toBe(
      404,
    );

    const exits = await request<MapExitsDto>('GET', `/api/maps/${mapId}/exits`, 'alice');
    expect(exits.body.exits.map((e) => [e.kind, e.name])).toEqual([
      ['connected', 'Tama'],
      ['static', 'J014348'],
    ]);
    expect(exits.body.exits[0]?.nearest?.name).toBe('Jita');

    // The runtime recomputes exits after chain changes and publishes them.
    await vi.waitFor(async () => expect((await events('routes.exits_changed')).length).toBeGreaterThan(0));
    const published = (await events('routes.exits_changed')).at(-1)!.data as { exits: unknown[] };
    expect(published.exits).toEqual(exits.body.exits);
    const snapshot = await request<StreamSnapshotDto>('GET', `/api/streams/map:${mapId}/snapshot`, 'alice');
    expect((snapshot.body.data as MapSnapshot).exits).toEqual(exits.body.exits);

    expect((await request('DELETE', `/api/maps/${mapId}/connections/${link.body.id}`, 'alice')).status).toBe(
      204,
    );
    await vi.waitFor(async () => {
      const last = (await events('routes.exits_changed')).at(-1)!.data as MapExitsDto;
      expect(last.exits.map((e) => e.name)).toEqual(['J014348']);
    });
  });

  it('keeps map hubs for managers and personal hubs for everyone', async () => {
    const put = await request<HubDto[]>('PUT', `/api/maps/${mapId}/hubs`, 'alice', {
      solarSystemIds: [AMAMAKE],
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject([{ name: 'Amamake', kind: 'map' }]);
    expect((await events('routes.hubs_changed')).map((e) => e.data)).toEqual([{ hubs: put.body }]);
    expect((await request('PUT', `/api/maps/${mapId}/hubs`, 'bob', { solarSystemIds: [] })).status).toBe(404);

    expect((await request('PUT', '/api/accounts/me/hubs', 'alice', { solarSystemIds: [TAMA] })).status).toBe(
      200,
    );
    expect((await request<HubDto[]>('GET', '/api/accounts/me/hubs', 'alice')).body).toMatchObject([
      { name: 'Tama' },
    ]);
    const hubs = await request<{ trade: HubDto[]; map: HubDto[]; personal: HubDto[] }>(
      'GET',
      `/api/maps/${mapId}/hubs`,
      'alice',
    );
    expect(hubs.body.trade).toHaveLength(5);
    expect(hubs.body.map.map((h) => h.name)).toEqual(['Amamake']);
    expect(hubs.body.personal.map((h) => h.name)).toEqual(['Tama']);

    const distances = await request<HubDistanceDto[]>(
      'GET',
      `/api/maps/${mapId}/hubs/distances?from=${AMAMAKE}&mode=pilot&securityStatus=-3`,
      'alice',
    );
    expect(distances.status).toBe(200);
    // Jita shows 0.9: a -3.0 pilot gets the nearest system they may enter instead.
    expect(distances.body.map((d) => d.name)).not.toContain('Jita');
    expect(distances.body.find((d) => d.kind === 'staging' && d.near?.name === 'Jita')?.jumps).toEqual(
      expect.any(Number),
    );
    expect(distances.body.find((d) => d.name === 'Tama')?.jumps).toEqual(expect.any(Number));
  });

  it('sets waypoints only for own characters whose grant allows it', async () => {
    const me = await request<MeDto>('GET', '/api/accounts/me', 'alice');
    expect(me.body.characters[0]).toMatchObject({ id: PILOT, canSetWaypoints: false });
    const set = (as: string, characterId: number) =>
      request('POST', `/api/accounts/me/characters/${characterId}/waypoint`, as, { solarSystemId: JITA });
    expect((await set('bob', PILOT)).status).toBe(404);
    const refused = await set('alice', PILOT);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      error: { message: expect.stringContaining('Link this character again') },
    });
  });

  it('records ships going through connections, also the jump that found the hole', async () => {
    expect(
      (await request('PUT', `/api/maps/${mapId}/tracking`, 'alice', { characterId: PILOT, tracked: true }))
        .status,
    ).toBe(204);
    const clock = new ManualClock();
    const esi = new FakeEsi(5_000, () => clock.now());
    const poller = new TrackingPoller({
      tracking: app.get<TrackingRepository>(TRACKING_REPOSITORY),
      characters: {
        character: (id) => app.get<CharacterService>(CHARACTER_TOKENS).character(id),
        accessToken: () => Promise.resolve('token'),
      },
      access: app.get<MapAccess>(MAP_ACCESS),
      esi,
      events: app.get<EventLog>(EVENT_LOG),
      uow: t.db,
      clock,
    });
    esi.set(PILOT, { online: true, location: HOME, ship: RIFTER, shipName: 'Rifter' });
    await poller.tick();
    esi.set(PILOT, { location: TAMA });
    clock.advance(5_000);
    await poller.tick();
    // Auto-mapping adds the connection after the jump; the passage is recorded all the same.
    await vi.waitFor(async () => {
      const intel = await request<ConnectionIntelDto[]>(
        'GET',
        `/api/maps/${mapId}/connections/intel`,
        'alice',
      );
      expect(intel.body).toHaveLength(1);
      expect(intel.body[0]).toMatchObject({
        wormholeType: 'U210',
        wormholeTypeFrom: 'static',
        mass: { passages: 1, passed: 1_067_000 },
      });
    });
    const [row] = (
      await request<ConnectionIntelDto[]>('GET', `/api/maps/${mapId}/connections/intel`, 'alice')
    ).body;
    const passages = await request<unknown[]>(
      'GET',
      `/api/maps/${mapId}/connections/${row!.connectionId}/passages`,
      'alice',
    );
    expect(passages.body).toEqual([
      expect.objectContaining({ characterId: PILOT, shipTypeId: RIFTER, from: HOME, to: TAMA }),
    ]);
    expect((await events('connection.passage')).map((e) => e.data)).toEqual([
      expect.objectContaining({ connectionId: row!.connectionId, mass: 1_067_000 }),
    ]);

    // And back again through the now known connection.
    esi.set(PILOT, { location: HOME });
    clock.advance(5_000);
    await poller.tick();
    await vi.waitFor(async () => expect(await events('connection.passage')).toHaveLength(2));
  });
});
