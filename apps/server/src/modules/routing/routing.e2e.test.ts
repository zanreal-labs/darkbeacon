import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManualClock, type EventLog, type MapAccess } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CharacterService } from '@darkbeacon/identity';
import type {
  ConnectionDto,
  ConnectionIntelDto,
  HubDistanceDto,
  HubDto,
  HubRoutesDto,
  ImportBridgesResultDto,
  MapDto,
  MapExitsDto,
  MapSnapshot,
  MeDto,
  RouteDto,
  RoutePreferencesDto,
  RoutesByDto,
  StationDto,
  StreamSnapshotDto,
  UniverseSystemDto,
  WayHomeDto,
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
    // Tama is low-sec and Jita high-sec: no single kind of space, so no colour under the exit.
    expect(exits.body.exits[0]?.nearest?.space).toBe('mixed');

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

  it('keeps map hubs for members and personal hubs for everyone', async () => {
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

  it('routes over pasted jump bridges, to every hub at once, by kind and home', async () => {
    const idOf = async (name: string) =>
      (await request<UniverseSystemDto[]>('GET', `/api/universe/systems?q=${name}&limit=1`, 'alice')).body[0]!
        .id;
    const dq = await idOf('1DQ1-A');
    const t5 = await idOf('4O-239');

    const paste = await request<ImportBridgesResultDto>('POST', `/api/maps/${mapId}/bridges/paste`, 'alice', {
      text: '4O-239 » 1DQ1-A - Home Bridge\nJita » Perimeter\nNowhere » 1DQ1-A\n1DQ1-A -> 4O-239\nPR-8CA » 1DQ1-A',
    });
    expect(paste.status).toBe(200);
    expect(paste.body).toMatchObject({ added: 1, known: 0, unknownSystems: ['Nowhere'] });
    // Jita is high-sec; PR-8CA is 5.6 ly from 1DQ1-A, past an Ansiblex's 5 ly.
    expect(paste.body.unreadable).toMatchObject([
      { line: 2, reason: expect.stringContaining('null-sec') },
      { line: 5, reason: '5.6 ly apart; an Ansiblex reaches 5 ly' },
    ]);
    expect(paste.body.bridges).toMatchObject([
      { a: { name: '4O-239' }, b: { name: '1DQ1-A' }, source: 'paste' },
    ]);
    expect(await events('routes.bridges_changed')).toHaveLength(1);

    const route = (query: string) =>
      request<RouteDto>('GET', `/api/maps/${mapId}/route?from=${dq}&to=${t5}${query}`, 'alice');
    expect((await route('')).body).toMatchObject({
      jumps: 1,
      steps: [{}, { via: 'bridge', edge: 'ansiblex' }],
    });
    expect((await route('&bridges=false')).body.jumps).toBeGreaterThan(1);
    expect((await route('&capital=true')).body.jumps).toBeGreaterThan(1);
    expect((await route('&skip=dangerous')).body.jumps).toBe(1);

    const bridge = paste.body.bridges[0]!;
    expect(
      (await request('PATCH', `/api/maps/${mapId}/bridges/${bridge.id}`, 'alice', { dangerous: true }))
        .status,
    ).toBe(200);
    expect((await route('&skip=dangerous')).body.jumps).toBeGreaterThan(1);
    expect((await request('GET', `/api/maps/${mapId}/bridges`, 'bob')).status).toBe(404);

    // Hubs: members keep the map's, everyone their own; one request routes to all of them.
    expect(
      (await request('PUT', `/api/maps/${mapId}/hubs`, 'alice', { solarSystemIds: [JITA, AMAMAKE, dq] }))
        .status,
    ).toBe(200);
    const all = await request<HubRoutesDto>('GET', `/api/maps/${mapId}/routes/hubs?from=${TAMA}`, 'alice');
    expect(all.status).toBe(200);
    expect(all.body.limit).toBe(20);
    expect(all.body.routes.map((r) => r.name).sort()).toEqual(['1DQ1-A', 'Amamake', 'Jita']);
    const hubJumps = all.body.routes.map((r) => r.jumps!);
    expect(hubJumps).toEqual([...hubJumps].sort((a, b) => a - b));
    const jita = all.body.routes.find((r) => r.name === 'Jita')!;
    expect(jita.steps[0]).toMatchObject({ solarSystemId: TAMA, via: 'start', regionName: 'The Citadel' });
    expect(jita.steps).toHaveLength(jita.jumps! + 1);
    const safer = await request<HubRoutesDto>(
      'GET',
      `/api/maps/${mapId}/routes/hubs?from=${TAMA}&mode=safer&avoidSpace=pochven,edencom`,
      'alice',
    );
    expect(safer.body.mode).toBe('safer');
    expect(
      (await request('PUT', '/api/accounts/me/hubs', 'alice', { solarSystemIds: [AMAMAKE] })).status,
    ).toBe(200);
    const mine = await request<HubRoutesDto>(
      'GET',
      `/api/maps/${mapId}/routes/hubs?from=${TAMA}&hubs=personal`,
      'alice',
    );
    expect(mine.body.routes.map((r) => [r.name, r.kind])).toEqual([['Amamake', 'personal']]);

    // Route options follow the viewer; the Thera toggle belongs to the map.
    const prefs = await request<RoutePreferencesDto>('PUT', '/api/accounts/me/route-preferences', 'alice', {
      mode: 'safer',
      skip: ['eol', 'eol'],
    });
    expect(prefs.body).toMatchObject({ mode: 'safer', skip: ['eol'], thera: true, capital: false });
    expect(
      (await request<RoutePreferencesDto>('GET', '/api/accounts/me/route-preferences', 'alice')).body.mode,
    ).toBe('safer');
    expect((await request('GET', `/api/maps/${mapId}/routing-settings`, 'alice')).body).toEqual({
      thera: true,
    });
    expect(
      (await request('PATCH', `/api/maps/${mapId}/routing-settings`, 'alice', { thera: false })).body,
    ).toEqual({ thera: false });
    expect((await events('routes.settings_changed')).map((e) => e.data)).toEqual([{ thera: false }]);

    // Routes By: the nearest security offices with their stations.
    const offices = await request<RoutesByDto>(
      'GET',
      `/api/maps/${mapId}/routes/by?from=${TAMA}&kind=securityOffice&limit=3`,
      'alice',
    );
    expect(offices.body.entries).toHaveLength(3);
    expect(offices.body.entries[0]!.stations[0]!.name).toMatch(/CONCORD|DED/);
    const jumps = offices.body.entries.map((e) => e.jumps);
    expect(jumps).toEqual([...jumps].sort((a, b) => a - b));
    const trade = await request<RoutesByDto>(
      'GET',
      `/api/maps/${mapId}/routes/by?from=${TAMA}&kind=tradeHubs&highsec=true`,
      'alice',
    );
    expect(trade.body.entries).toHaveLength(5);
    expect(trade.body.entries.find((e) => e.name === 'Jita')!.stations[0]).toMatchObject({
      id: 60003760,
      main: true,
    });
    const stations = await request<StationDto[]>('GET', `/api/universe/systems/${JITA}/stations`, 'alice');
    expect(stations.body.length).toBeGreaterThan(5);

    // Way home: from each map hub back into the chain, through its mouth.
    for (const id of [HOME, TAMA]) {
      await request('POST', `/api/maps/${mapId}/systems`, 'alice', { solarSystemId: id });
    }
    await request('POST', `/api/maps/${mapId}/connections`, 'alice', { source: HOME, target: TAMA });
    await request('PATCH', `/api/maps/${mapId}/systems/${HOME}`, 'alice', { status: 'home' });
    await vi.waitFor(async () => {
      const last = (await events('routes.way_home_changed')).at(-1)?.data as WayHomeDto | undefined;
      expect(last?.home?.name).toBe('J014348');
      expect(last?.routes.find((r) => r.hub.name === 'Jita')).toMatchObject({ mouth: { name: 'Tama' } });
    });
    const home = await request<WayHomeDto>('GET', `/api/maps/${mapId}/way-home`, 'alice');
    expect(home.body.routes[0]!.mouth.name).toBe('Tama');
    expect(home.body.routes.every((r) => !r.viaEveScout)).toBe(true);

    expect((await request('DELETE', `/api/maps/${mapId}/bridges`, 'alice')).status).toBe(204);
    expect((await request<unknown[]>('GET', `/api/maps/${mapId}/bridges`, 'alice')).body).toEqual([]);
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
