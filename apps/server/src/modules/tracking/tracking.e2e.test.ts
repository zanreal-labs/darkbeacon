import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManualClock, type EventLog, type MapAccess } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CharacterService } from '@darkbeacon/identity';
import type { ConnectionDto, MapDto, MapSnapshot, MapSystemDto, MeDto } from '@darkbeacon/shared';
import { TrackingPoller, type TrackingRepository } from '@darkbeacon/tracking';
import { FakeEsi } from '@darkbeacon/tracking/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapUseCases } from '@darkbeacon/mapping';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { CHARACTER_TOKENS, EVENT_LOG, MAP_ACCESS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { TRACKING_REPOSITORY } from './tracking.module.js';

const PILOT = 90000001;
const ALT = 90000002;
const JITA = 30000142;
const PERIMETER = 30000144;
const J_SPACE = 31000007; // J105443, C1

/** Tracking, universe and auto-mapping wired to the real identity, access and mapping modules. */
describeEachDialect('tracking and universe over HTTP', (t) => {
  let app: NestFastifyApplication;
  /** Session cookie per dev-login name. */
  const cookies = new Map<string, string>();
  const accounts = new Map<string, string>();
  let mapId: string;

  const request = async (
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
      body: response.body ? (JSON.parse(response.body) as unknown) : null,
      cookie: response.headers['set-cookie'],
    };
  };

  const signIn = async (name: string, character: { id: number; name: string }) => {
    const response = await request('POST', '/api/auth/dev', undefined, { name, character });
    const setCookie = [response.cookie].flat()[0]!;
    cookies.set(name, setCookie.split(';')[0]!);
    accounts.set(name, (response.body as MeDto).account.id);
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', DEMO_MODE: 'true' }),
      secretKey: 'x'.repeat(32),
      dataDir: '/nonexistent',
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.getHttpAdapter().getInstance().ready();
    await signIn('alice', { id: PILOT, name: 'Pilot' });
    await signIn('bob', { id: ALT, name: 'Alt' });
    mapId = ((await request('POST', '/api/maps', 'alice', { name: 'Chain' })).body as MapDto).id;
    await request('POST', `/api/maps/${mapId}/access-rules`, 'alice', {
      subjectKind: 'account',
      subjectId: accounts.get('bob'),
      role: 'viewer',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('takes character tokens from identity', () => {
    expect(app.get<CharacterService>(CHARACTER_TOKENS).constructor.name).toBe('CharacterService');
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
        statics: [],
        effect: null,
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
      statics: [],
      effect: null,
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
      request('PUT', `/api/maps/${mapId}/tracking`, as, { characterId, tracked });

    expect((await track('alice', PILOT, true)).status).toBe(204);
    expect((await track('bob', ALT, true)).status).toBe(403);
    expect((await track('alice', ALT, true)).status).toBe(404);
    expect((await request('PUT', `/api/maps/${mapId}/tracking`, 'alice', { characterId: 'x' })).status).toBe(
      400,
    );

    const listed = await request('GET', `/api/maps/${mapId}/characters`, 'bob');
    expect(listed.body).toEqual([
      expect.objectContaining({ characterId: PILOT, name: 'Pilot', online: false }),
    ]);
    expect((await request('GET', '/api/maps/nope/characters', 'bob')).status).toBe(404);

    // Drive a poller over the app's repository and event log with a fake ESI and a manual clock.
    const clock = new ManualClock();
    const esi = new FakeEsi(5_000, () => clock.now());
    const log = app.get<EventLog>(EVENT_LOG);
    const poller = new TrackingPoller(
      {
        tracking: app.get<TrackingRepository>(TRACKING_REPOSITORY),
        characters: {
          character: (id) => app.get<CharacterService>(CHARACTER_TOKENS).character(id),
          accessToken: () => Promise.resolve('token'),
        },
        access: app.get<MapAccess>(MAP_ACCESS),
        esi,
        events: log,
        uow: t.db,
        clock,
      },
      undefined,
      { random: () => 0 }, // no startup spread or jitter: the test steps the clock itself
    );
    esi.set(PILOT, { online: true, location: J_SPACE, ship: 11132, shipName: 'Probe' });
    await poller.tick();
    esi.set(PILOT, { location: JITA });
    clock.advance(5_000);
    await poller.tick();

    expect((await log.readSince(`map:${mapId}`, 0)).map((e) => e.type)).toEqual([
      'map.created',
      'access.rule_added',
      'character.tracked',
      'character.online_changed',
      'character.ship_changed',
      'character.moved',
      'character.moved',
      'character.jumped',
    ]);
    // Auto-mapping puts both systems and a wormhole connection on the real map.
    const snapshotOf = async () => {
      const parts = app.get(RealtimeRegistry).snapshotProviders('map');
      const merged = {};
      for (const part of parts) Object.assign(merged, await part(mapId, { kind: 'plugin', id: 'test' }));
      return merged as Required<MapSnapshot>;
    };
    await vi.waitFor(async () => {
      const { systems, connections } = await snapshotOf();
      expect(systems.map((s: MapSystemDto) => s.solarSystemId).sort()).toEqual([JITA, J_SPACE].sort());
      expect(connections).toEqual([expect.objectContaining({ type: 'wormhole' }) as ConnectionDto]);
    });

    // The audit trail says the jump was mapped by auto-mapping with the character that jumped,
    // and the moves came from ESI tracking, both on behalf of the character's owner.
    const audits = await t.db
      .db<{ event_log: { stream: string; type: string; audit: string | null } }>()
      .selectFrom('event_log')
      .select(['type', 'audit'])
      .where('stream', '=', `map:${mapId}`)
      .execute();
    const auditOf = (type: string) =>
      JSON.parse(audits.find((r) => r.type === type)!.audit!) as {
        channel: unknown;
        actor: { characterId: number; characterName: string; accountName: string };
      };
    expect(auditOf('connection.added')).toMatchObject({
      channel: { kind: 'system', id: 'auto-mapping' },
      actor: { characterId: PILOT, characterName: 'Pilot', accountName: 'alice' },
    });
    expect(auditOf('character.jumped')).toMatchObject({
      channel: { kind: 'system', id: 'tracking' },
      actor: { characterId: PILOT, accountName: 'alice' },
    });

    // With high-sec in scope a gate jump is mapped as a gate.
    await request('PATCH', `/api/maps/${mapId}`, 'alice', { settings: { scopes: ['wormhole', 'high'] } });
    esi.set(PILOT, { location: PERIMETER });
    clock.advance(5_000);
    await poller.tick();
    await vi.waitFor(async () =>
      expect((await snapshotOf()).connections).toContainEqual(
        expect.objectContaining({ type: 'gate' }) as ConnectionDto,
      ),
    );
    expect((await snapshotOf()).characters).toEqual([
      expect.objectContaining({ characterId: PILOT, solarSystemId: PERIMETER, online: true }),
    ]);

    expect((await track('alice', PILOT, false)).status).toBe(204);
    expect((await request('GET', `/api/maps/${mapId}/characters`, 'alice')).body).toEqual([]);
  });

  it('forgets everything about a deleted map in the other modules', async () => {
    expect(
      (await request('PUT', `/api/maps/${mapId}/tracking`, 'alice', { characterId: PILOT, tracked: true }))
        .status,
    ).toBe(204);
    const hook = await request('POST', `/api/maps/${mapId}/webhooks`, 'alice', {
      url: 'https://example.com/hook',
      events: ['system.*'],
    });
    expect(hook.status).toBe(201);
    const count = async (table: string) => {
      const rows = await t.db
        .db<Record<string, { map_id: string }>>()
        .selectFrom(table)
        .select('map_id')
        .where('map_id', '=', mapId)
        .execute();
      return rows.length;
    };
    expect([await count('access_rule'), await count('tracked_character'), await count('webhook')]).toEqual([
      1, 1, 1,
    ]);

    expect((await request('DELETE', `/api/maps/${mapId}`, 'alice')).status).toBe(204);
    // Deleting is soft; purging is what the other modules follow.
    await app.get(MapUseCases).purge({ kind: 'account', id: 'root', instanceRole: 'admin' }, mapId);
    await vi.waitFor(async () =>
      expect([await count('access_rule'), await count('tracked_character'), await count('webhook')]).toEqual([
        0, 0, 0,
      ]),
    );
  });

  it('stops tracking a character once it is unlinked', async () => {
    await request('PUT', `/api/maps/${mapId}/tracking`, 'alice', { characterId: PILOT, tracked: true });
    expect((await request('DELETE', `/api/accounts/me/characters/${PILOT}`, 'alice')).status).toBe(204);
    await vi.waitFor(async () =>
      expect((await request('GET', `/api/maps/${mapId}/characters`, 'alice')).body).toEqual([]),
    );
    const log = app.get<EventLog>(EVENT_LOG);
    expect((await log.readSince(`map:${mapId}`, 0)).at(-1)).toMatchObject({
      type: 'character.untracked',
      data: { characterId: PILOT },
    });
  });
});
