import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManualClock, type EventLog, type MapAccess } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CharacterService } from '@darkbeacon/identity';
import type { ConnectionDto, MapDto, MapSnapshot, MapSystemDto, MeDto } from '@darkbeacon/shared';
import { TrackingPoller, type TrackingRepository } from '@darkbeacon/tracking';
import { FakeEsi } from '@darkbeacon/tracking/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { CHARACTER_TOKENS, EVENT_LOG, MAP_ACCESS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { TRACKING_REPOSITORY } from './tracking.module.js';

const PILOT = 90000001;
const J105443 = 31000007; // C1
const PERIMETER = 30000144; // high-sec
const URLEN = 30000139; // high-sec, a stargate from Perimeter
const THERA = 31000005;
const AMAMAKE = 30002537; // low-sec, no stargate from Thera
const AMARR = 30002187; // high-sec, far from all of them: where the clone waits

/**
 * Wanderer's automapper on the real universe: a pilot's location changes as ESI reports them,
 * through the poller, and what auto-mapping puts on the map after each kind of jump.
 */
describeEachDialect('auto-mapping a tracked pilot’s jumps', (t) => {
  let app: NestFastifyApplication;
  let cookie = '';
  let mapId: string;
  let clock: ManualClock;
  let esi: FakeEsi;
  let poller: TrackingPoller;

  const request = async (
    method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ) => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: { cookie },
        ...(body === undefined ? {} : { payload: body as object }),
      });
    return {
      status: response.statusCode,
      body: response.body ? (JSON.parse(response.body) as unknown) : null,
    };
  };

  const snapshot = async () => {
    const merged = {};
    for (const part of app.get(RealtimeRegistry).snapshotProviders('map'))
      Object.assign(merged, await part(mapId, { kind: 'plugin', id: 'test' }));
    return merged as Required<MapSnapshot>;
  };
  const systems = async () =>
    new Map((await snapshot()).systems.map((s: MapSystemDto) => [s.solarSystemId, s]));
  const links = async () =>
    (await snapshot()).connections
      .map((c: ConnectionDto) => `${Math.min(c.source, c.target)}-${Math.max(c.source, c.target)} ${c.type}`)
      .sort();
  const link = (a: number, b: number, type: string) => `${Math.min(a, b)}-${Math.max(a, b)} ${type}`;

  /** ESI reports the pilot somewhere else; the next location poll sees it. */
  const arrive = async (solarSystemId: number, docked = false) => {
    esi.set(PILOT, { location: solarSystemId, docked });
    clock.advance(5_000);
    await poller.tick();
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }),
      secretKey: 'x'.repeat(32),
      dataDir: '/nonexistent',
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.getHttpAdapter().getInstance().ready();
    const signIn = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/dev',
        payload: { name: 'alice', character: { id: PILOT, name: 'Pilot' } },
      });
    cookie = [signIn.headers['set-cookie']].flat()[0]!.split(';')[0]!;
    expect((JSON.parse(signIn.body) as MeDto).characters).toHaveLength(1);
    // A new map: auto-mapping adds wormhole space only, as Wanderer's default scope does.
    mapId = ((await request('POST', '/api/maps', { name: 'Chain' })).body as MapDto).id;
    expect(
      (await request('PUT', `/api/maps/${mapId}/tracking`, { characterId: PILOT, tracked: true })).status,
    ).toBe(204);

    clock = new ManualClock();
    esi = new FakeEsi(5_000, () => clock.now());
    poller = new TrackingPoller(
      {
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
      },
      undefined,
      { random: () => 0 },
    );
    // Online in J105443: tracking starts the chain where the pilot is.
    esi.set(PILOT, { online: true, location: J105443, ship: 11132, shipName: 'Probe' });
    await poller.tick();
    await vi.waitFor(async () => expect([...(await systems()).keys()]).toEqual([J105443]));
  });

  afterEach(async () => {
    await app.close();
  });

  it('maps a wormhole jump, leaves stargate travel out of a wormhole map, and maps Thera', async () => {
    // Out of the hole into high-sec: both ends and a wormhole connection.
    await arrive(PERIMETER);
    await vi.waitFor(async () => expect(await links()).toEqual([link(J105443, PERIMETER, 'wormhole')]));
    const at = await systems();
    // Placed next to the system it came from.
    expect(at.get(PERIMETER)!.position.x).toBeGreaterThan(at.get(J105443)!.position.x);

    // Through a stargate in high-sec: no wormhole end, high-sec not in scope (Wanderer's rule).
    await arrive(URLEN);
    // Into Thera, which no stargate reaches: a wormhole connection.
    await arrive(PERIMETER);
    await arrive(THERA);
    await vi.waitFor(async () =>
      expect(await links()).toEqual(
        [link(J105443, PERIMETER, 'wormhole'), link(PERIMETER, THERA, 'wormhole')].sort(),
      ),
    );
    expect([...(await systems()).keys()].sort()).toEqual([J105443, PERIMETER, THERA].sort());
  });

  it('maps a stargate jump as a gate once both ends are in scope', async () => {
    await request('PATCH', `/api/maps/${mapId}`, { settings: { scopes: ['wormhole', 'high'] } });
    await arrive(PERIMETER);
    await arrive(URLEN);
    await vi.waitFor(async () =>
      expect(await links()).toEqual(
        [link(J105443, PERIMETER, 'wormhole'), link(PERIMETER, URLEN, 'gate')].sort(),
      ),
    );
  });

  it('maps a gate-less jump between known-space systems as a wormhole', async () => {
    await arrive(PERIMETER);
    await arrive(AMAMAKE);
    await vi.waitFor(async () => expect(await links()).toContain(link(PERIMETER, AMAMAKE, 'wormhole')));
  });

  it('maps no connection and no system for a pod express to the clone station', async () => {
    await arrive(THERA);
    await vi.waitFor(async () => expect(await links()).toEqual([link(J105443, THERA, 'wormhole')]));
    // Podded in Thera: the pilot wakes up docked in Amarr, far from any hole.
    await arrive(AMARR, true);
    await arrive(AMARR, true);
    const types = (await app.get<EventLog>(EVENT_LOG).readSince(`map:${mapId}`, 0)).map((e) => e.type);
    expect(types.filter((type) => type === 'character.jumped')).toHaveLength(1);
    expect(await links()).toEqual([link(J105443, THERA, 'wormhole')]);
    expect((await systems()).has(AMARR)).toBe(false);
  });

  it('brings systems the map hid back next to the jump, locked or not, not where they stood', async () => {
    // A Wanderer import keeps every system ever visited, hidden (often locked), far from today's
    // chain: there, a jump used to bring them back out of sight.
    for (const [solarSystemId, locked] of [
      [PERIMETER, false],
      [AMAMAKE, true],
    ] as const) {
      await request('POST', `/api/maps/${mapId}/systems`, {
        solarSystemId,
        position: { x: 24000, y: 24000 },
      });
      const hidden = await request('PATCH', `/api/maps/${mapId}/systems/${solarSystemId}`, {
        locked,
        visible: false,
      });
      expect(hidden.status).toBe(200);
    }
    expect([...(await systems()).keys()]).toEqual([J105443]);

    await arrive(PERIMETER);
    await arrive(AMAMAKE);
    await vi.waitFor(async () => expect((await systems()).has(AMAMAKE)).toBe(true));
    const at = await systems();
    const near = (a: number, b: number) => {
      const [p, q] = [at.get(a)!.position, at.get(b)!.position];
      return Math.abs(p.x - q.x) < 1000 && Math.abs(p.y - q.y) < 1000;
    };
    expect(near(PERIMETER, J105443)).toBe(true);
    expect(near(AMAMAKE, PERIMETER)).toBe(true);
    expect(at.get(AMAMAKE)!.locked).toBe(true);
  });
});
