import { afterEach, beforeEach, expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { CharacterPresenceDto, MapDto, MapTrackedCharacterDto, MeDto } from '@darkbeacon/shared';
import type { TrackingRepository } from '@darkbeacon/tracking';
import { startTestApp, type TestApp } from '../../test-support/test-app.js';
import { TRACKING_REPOSITORY } from './tracking.module.js';

describeEachDialect('the map characters page', (t) => {
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

  it('shows managers every tracked character, untracks others and hides offline ones from viewers', async () => {
    const alice = await signUp('alice', 95000001);
    const bob = await signUp('bob', 95000002);
    const vic = await signUp('vic', 95000003);
    const map = (await s.call('POST', '/api/maps', alice, { name: 'Home' })).body as MapDto;
    const base = `/api/maps/${map.id}`;
    await s.call('POST', `${base}/access-rules`, alice, {
      subjectKind: 'account',
      subjectId: bob,
      role: 'member',
    });
    await s.call('POST', `${base}/access-rules`, alice, {
      subjectKind: 'account',
      subjectId: vic,
      role: 'viewer',
    });
    await s.call('PUT', `${base}/tracking`, alice, { characterId: 95000001, tracked: true });
    await s.call('PUT', `${base}/tracking`, bob, { characterId: 95000002, tracked: true });

    const page = (await s.call('GET', `${base}/tracking/characters`, alice)).body as MapTrackedCharacterDto[];
    expect(page.map((c) => [c.name, c.accountName])).toEqual(
      expect.arrayContaining([
        ['alice Main', 'alice'],
        ['bob Main', 'bob'],
      ]),
    );
    expect((await s.call('GET', `${base}/tracking/characters`, bob)).status).toBe(403);

    // Alice is online, Bob is not; with the option on, the viewer sees only Alice.
    const tracking = s.app.get<TrackingRepository>(TRACKING_REPOSITORY);
    const presence = (await tracking.getPresence(95000001))!;
    await tracking.savePresence({ ...presence, online: true, solarSystemId: 31000101 });
    await s.call('PATCH', base, alice, { settings: { offlineForManagersOnly: true } });
    const seen = (await s.call('GET', `${base}/characters`, vic)).body as CharacterPresenceDto[];
    expect(seen.map((c) => c.characterId)).toEqual([95000001]);
    const snapshot = (await s.call('GET', `/api/streams/map:${map.id}/snapshot`, vic)).body as {
      data: { characters: CharacterPresenceDto[] };
    };
    expect(snapshot.data.characters.map((c) => c.characterId)).toEqual([95000001]);
    expect(((await s.call('GET', `${base}/characters`, alice)).body as unknown[]).length).toBe(2);

    // A manager takes Bob's character off the map; Bob may track it again.
    expect((await s.call('DELETE', `${base}/tracking/characters/95000002`, bob)).status).toBe(403);
    expect((await s.call('DELETE', `${base}/tracking/characters/95000002`, alice)).status).toBe(204);
    expect(((await s.call('GET', `${base}/characters`, alice)).body as unknown[]).length).toBe(1);
    expect((await s.call('DELETE', `${base}/tracking/characters/95000002`, alice)).status).toBe(404);
    const history = (await s.call('GET', `${base}/history`, alice)).body as {
      entries: Array<{ type: string; actor: { accountId?: string } }>;
    };
    expect(history.entries.find((e) => e.type === 'character.untracked')?.actor.accountId).toBe(alice);
  }, 20_000);
});
