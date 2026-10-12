import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  CharacterActivityDto,
  EveServerStatusDto,
  MapDto,
  MapTrackingSettingsDto,
  MeDto,
  MyTrackingDto,
  OnlineCountsDto,
  UserPreferencesDto,
} from '@darkbeacon/shared';
import type { TrackingRepository } from '@darkbeacon/tracking';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';
import { TRACKING_REPOSITORY } from './tracking.module.js';

describeEachDialect('characters across maps', (t) => {
  let s: TestApp;

  beforeEach(async () => {
    s = await startTestApp(t.db, {}, { DEMO_MODE: 'true' });
  });
  afterEach(async () => {
    await s.close();
  });

  const signUp = async (name: string, characterId: number) =>
    (
      (
        await s.call('POST', '/api/auth/dev', null, {
          name,
          character: { name: `${name} Main`, id: characterId },
        })
      ).body as MeDto
    ).account.id;

  it('shows my characters on every map, the online count, my settings on a map and activity', async () => {
    const alice = await signUp('alice', 95000001);
    const bob = await signUp('bob', 95000002);
    const map = (await s.call('POST', '/api/maps', alice, { name: 'Home' })).body as MapDto;
    const other = (await s.call('POST', '/api/maps', bob, { name: 'Elsewhere' })).body as MapDto;
    await s.call('POST', `/api/maps/${map.id}/access-rules`, alice, {
      subjectKind: 'account',
      subjectId: bob,
      role: 'viewer',
    });
    expect(
      (await s.call('PUT', `/api/maps/${map.id}/tracking`, alice, { characterId: 95000001, tracked: true }))
        .status,
    ).toBe(204);

    const tracking = s.app.get<TrackingRepository>(TRACKING_REPOSITORY);
    const presence = (await tracking.getPresence(95000001))!;
    await tracking.savePresence({ ...presence, online: true, solarSystemId: 31000101, docked: true });

    const mine = (await s.call('GET', '/api/accounts/me/tracking', alice)).body as MyTrackingDto;
    expect(mine.characters).toEqual([
      expect.objectContaining({
        characterId: 95000001,
        solarSystemId: 31000101,
        online: true,
        docked: true,
        trackedOn: [map.id],
      }),
    ]);
    expect(mine.maps).toEqual([{ id: map.id, name: 'Home', slug: map.slug, canTrack: true }]);
    // Bob sees Home as a viewer: he may not track there.
    const bobs = (await s.call('GET', '/api/accounts/me/tracking', bob)).body as MyTrackingDto;
    expect(bobs.maps.map((m) => [m.name, m.canTrack])).toEqual([
      ['Elsewhere', true],
      ['Home', false],
    ]);

    const counts = (await s.call('GET', '/api/tracking/online', bob)).body as OnlineCountsDto;
    expect(counts.counts).toEqual({ [map.id]: 1, [other.id]: 0 });

    // The character list carries the corporation of each character.
    const characters = (await s.call('GET', `/api/maps/${map.id}/characters`, bob)).body as Array<{
      corporationId?: number;
      docked?: boolean;
    }>;
    expect(characters[0]).toMatchObject({ corporationId: expect.any(Number), docked: true });

    // My main and followed character on the map: only my own characters.
    const base = `/api/maps/${map.id}/tracking/me`;
    expect((await s.call('GET', base, alice)).body).toEqual({
      mainCharacterId: null,
      followCharacterId: null,
    });
    const set = await s.call('PUT', base, alice, { followCharacterId: 95000001 });
    expect(set.body as MapTrackingSettingsDto).toEqual({
      mainCharacterId: null,
      followCharacterId: 95000001,
    });
    expect((await s.call('PUT', base, alice, { mainCharacterId: 95000002 })).status).toBe(404);
    expect((await s.call('GET', base, bob)).body).toEqual({ mainCharacterId: null, followCharacterId: null });
    expect((await s.call('GET', `/api/maps/${other.id}/tracking/me`, alice)).status).toBe(404);

    // Activity: Alice adds a system as her main character.
    await s.call('PUT', '/api/accounts/me/main-character', alice, { characterId: 95000001 });
    expect(
      (await s.call('POST', `/api/maps/${map.id}/systems`, alice, { solarSystemId: SYSTEMS.c2 })).status,
    ).toBe(201);
    const activity = (await s.call('GET', `/api/maps/${map.id}/tracking/activity?period=30d`, bob))
      .body as CharacterActivityDto[];
    expect(activity).toEqual([
      expect.objectContaining({ characterId: 95000001, name: 'alice Main', systems: 1, jumps: 0 }),
    ]);
    expect((await s.call('GET', `/api/maps/${map.id}/tracking/activity?period=week`, bob)).status).toBe(400);
  }, 20_000);

  it('keeps my preferences on the server and tells TQ status', async () => {
    const alice = await signUp('alice', 95000001);
    const empty = (await s.call('GET', '/api/accounts/me/preferences', alice)).body as UserPreferencesDto;
    expect(empty.preferences).toEqual({});
    const saved = (
      await s.call('PUT', '/api/accounts/me/preferences', alice, {
        preferences: { local: { compact: true }, sidebar: { hidden: ['kills'] } },
      })
    ).body as UserPreferencesDto;
    expect(saved.preferences).toEqual({ local: { compact: true }, sidebar: { hidden: ['kills'] } });
    const removed = (
      await s.call('PUT', '/api/accounts/me/preferences', alice, { preferences: { sidebar: null } })
    ).body as UserPreferencesDto;
    expect(removed.preferences).toEqual({ local: { compact: true } });
    expect(
      (await s.call('PUT', '/api/accounts/me/preferences', alice, { preferences: { 'Bad Area': 1 } })).status,
    ).toBe(400);
    expect(
      (
        await s.call('PUT', '/api/accounts/me/preferences', alice, {
          preferences: { local: { note: 'x'.repeat(20_000) } },
        })
      ).status,
    ).toBe(400);
    expect((await s.call('GET', '/api/accounts/me/preferences', null)).status).toBe(401);

    // Demo characters have no EVE grant: no wallet to read.
    expect((await s.call('GET', '/api/accounts/me/characters/95000001/wallet', alice)).status).toBe(400);
    expect((await s.call('GET', '/api/accounts/me/characters/95000009/wallet', alice)).status).toBe(404);

    // Tests never ask ESI: nothing is known about TQ and tracking runs.
    const status = (await s.call('GET', '/api/eve/status', alice)).body as EveServerStatusDto;
    expect(status).toMatchObject({ online: null, trackingPaused: false });
  }, 20_000);
});
