import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { ConnectionDto, CreatedApiKeyDto, MapDto, MeDto, SignatureDto } from '@darkbeacon/shared';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { SseReader } from '../../test-support/sse.js';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';

describeEachDialect('Wanderer-compatible API', (t) => {
  let s: TestApp;
  let alice: string;
  let map: MapDto;
  let token: string;

  const wanderer = (path: string, key: string | null = token) =>
    fetch(`http://${s.base}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then(
      async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }),
    );

  beforeEach(async () => {
    s = await startTestApp(t.db, {}, { DEMO_MODE: 'true' });
    const me = await s.call('POST', '/api/auth/dev', null, {
      name: 'alice',
      character: { name: 'Alice Main', id: 95000001, corporationId: 98000001 },
    });
    alice = (me.body as MeDto).account.id;
    map = (await s.call('POST', '/api/maps', alice, { name: 'Home Chain' })).body as MapDto;
    const base = `/api/maps/${map.id}`;
    await s.call('PUT', `${base}/labels`, alice, {
      labels: [{ id: 'l1', name: 'B', color: '#ff0000', description: '' }],
    });
    await s.call('POST', `${base}/systems`, alice, {
      solarSystemId: SYSTEMS.c2,
      position: { x: 10.4, y: 20.6 },
    });
    await s.call('POST', `${base}/systems`, alice, { solarSystemId: SYSTEMS.c5 });
    await s.call('PATCH', `${base}/systems/${SYSTEMS.c2}`, alice, {
      status: 'home',
      tag: 'H',
      customName: 'Home',
      labelIds: ['l1'],
    });
    const hole = (
      await s.call('POST', `${base}/connections`, alice, { source: SYSTEMS.c2, target: SYSTEMS.c5 })
    ).body as ConnectionDto;
    await s.call('PATCH', `${base}/connections/${hole.id}`, alice, {
      massStatus: 'reduced',
      timeStatus: 'eol',
    });
    const sig = (
      await s.call('POST', `${base}/systems/${SYSTEMS.c2}/signatures`, alice, {
        eveId: 'ABC-123',
        group: 'wormhole',
        type: 'C247',
      })
    ).body as SignatureDto;
    await s.call('PATCH', `${base}/signatures/${sig.id}`, alice, { connectionId: hole.id });
    // Wanderer's map key becomes a Darkbeacon key that reads this one map.
    const key = await s.call('POST', '/api/accounts/me/api-keys', alice, {
      name: 'notifier',
      scopes: [`map:${map.id}:*:read`],
      readOnly: true,
    });
    token = (key.body as CreatedApiKeyDto).token;
  });
  afterEach(async () => {
    await s.close();
  });

  it('answers /api/map/* in Wanderer’s shapes', async () => {
    const systems = await wanderer(`/api/map/systems?slug=${map.slug}`);
    expect(systems.status).toBe(200);
    const data = systems.body.data as { systems: Array<Record<string, unknown>>; connections: unknown[] };
    const home = data.systems.find((x) => x.solar_system_id === SYSTEMS.c2)!;
    expect(home).toMatchObject({
      map_id: map.id,
      name: 'Home',
      original_name: 'J100101',
      custom_name: 'Home',
      temporary_name: null,
      tag: 'H',
      status: 1,
      locked: false,
      visible: true,
      position_x: 10,
      position_y: 21,
      labels: JSON.stringify({ customLabel: '', labels: ['B'] }),
    });
    expect(home.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(home.inserted_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    expect(data.connections).toEqual([
      expect.objectContaining({
        solar_system_source: SYSTEMS.c2,
        solar_system_target: SYSTEMS.c5,
        mass_status: 1,
        time_status: 1,
        ship_size_type: 2,
        type: 0,
        wormhole_type: 'C247',
        locked: false,
      }),
    ]);

    expect((await wanderer(`/api/map/system?map_id=${map.id}&id=${SYSTEMS.c5}`)).body).toMatchObject({
      data: { solar_system_id: SYSTEMS.c5, name: 'J100104', status: 0 },
    });
    expect(await wanderer(`/api/map/system?map_id=${map.id}&id=1`)).toEqual({
      status: 404,
      body: { error: 'Not found', details: 'The requested resource could not be found' },
    });
    expect((await wanderer(`/api/map/connections?map_id=${map.id}`)).body.data).toHaveLength(1);
    expect((await wanderer(`/api/maps/${map.slug}/systems`)).status).toBe(200);
    expect(
      (await wanderer(`/api/maps/${map.id}/connections?solar_system_source=${SYSTEMS.c5}`)).body.data,
    ).toEqual([]);

    // Characters: tracked ones, with corporation and alliance.
    await s.call('PUT', `/api/maps/${map.id}/tracking`, alice, { characterId: 95000001, tracked: true });
    const characters = await wanderer(`/api/map/characters?slug=${map.slug}`);
    expect(characters.body.data).toEqual([
      expect.objectContaining({
        map_id: map.id,
        tracked: true,
        character: expect.objectContaining({
          eve_id: '95000001',
          name: 'Alice Main',
          corporation_id: 98000001,
        }),
      }),
    ]);
    expect((await wanderer(`/api/maps/${map.slug}/tracked-characters`)).body.data).toHaveLength(1);
    await s.call('PUT', '/api/accounts/me/main-character', alice, { characterId: 95000001 });
    expect((await wanderer(`/api/map/user_characters?slug=${map.slug}`)).body).toEqual({
      data: [
        { characters: [expect.objectContaining({ eve_id: '95000001' })], main_character_eve_id: '95000001' },
      ],
    });

    // Wanderer's errors.
    expect(await wanderer('/api/map/systems')).toEqual({
      status: 400,
      body: {
        error: 'Map identifier required. Provide `map_identifier` in the path or `map_id`/`slug` in query.',
      },
    });
    expect(await wanderer('/api/map/systems?slug=nope')).toEqual({
      status: 404,
      body: { error: 'Map not found for slug: nope' },
    });
    expect((await wanderer(`/api/map/systems?slug=${map.slug}`, null)).body).toEqual({
      error: "Missing or invalid 'Bearer' token",
    });
    const other = (await s.call('POST', '/api/maps', alice, { name: 'Other' })).body as MapDto;
    expect(await wanderer(`/api/map/systems?slug=${other.slug}`)).toEqual({
      status: 401,
      body: { error: 'Unauthorized (invalid token for map)' },
    });
    // A Darkbeacon key's own errors still apply to a key that is not valid at all.
    expect((await wanderer(`/api/map/systems?slug=${map.slug}`, 'dbk_pat_nope')).status).toBe(401);
  });

  it('streams Wanderer events over SSE with backfill after last_event_id', async () => {
    const url = `http://${s.base}/api/maps/${map.slug}/events/stream`;
    const first = new SseReader(`${url}?events=add_system,deleted_system,connection_removed`, {
      authorization: `Bearer ${token}`,
    });
    const connected = await first.waitFor((f) => f.event === 'connected');
    expect(connected.data).toMatchObject({ map_id: map.id });
    expect(connected.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect((await first.response).headers.get('access-control-allow-origin')).toBe('*');

    await s.call('POST', `/api/maps/${map.id}/systems`, alice, {
      solarSystemId: SYSTEMS.c1,
      position: { x: 5, y: 5 },
    });
    const added = await first.waitFor((f) => f.event === 'add_system');
    expect(added.data).toMatchObject({
      type: 'add_system',
      map_id: map.id,
      payload: { solar_system_id: SYSTEMS.c1, name: 'J100102', position_x: 5, position_y: 5 },
    });
    expect(added.id).toBe((added.data as { id: string }).id);
    // Removing C5 removes its connection first: both carry what Wanderer names.
    await s.call('DELETE', `/api/maps/${map.id}/systems/${SYSTEMS.c5}`, alice);
    const removed = await first.waitFor((f) => f.event === 'connection_removed');
    expect((removed.data as { payload: unknown }).payload).toMatchObject({
      solar_system_source_id: SYSTEMS.c2,
      solar_system_target_id: SYSTEMS.c5,
    });
    await first.waitFor((f) => f.event === 'deleted_system');
    // Not asked for: no system_metadata_changed.
    expect(first.frames.some((f) => f.event === 'system_metadata_changed')).toBe(false);
    await first.close();

    // Reconnect with the last id: what came after it is sent again, then live.
    const again = new SseReader(`${url}?last_event_id=${added.id}`, { authorization: `Bearer ${token}` });
    await again.waitFor((f) => f.event === 'deleted_system');
    expect(again.frames.some((f) => f.event === 'add_system')).toBe(false);
    await again.close();

    const refused = await fetch(url, { headers: { authorization: 'Bearer dbk_pat_nope' } });
    expect(refused.status).toBe(401);
  });
});
