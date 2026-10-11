import { ManualClock, type Actor } from '@wormwright/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ListMapCharacters, SetTracking } from '../application/tracking.js';
import {
  fakeAccess,
  fakeCharacters,
  MemoryEventLog,
  MemoryTrackingRepository,
  passThroughUow,
} from '../test-support.js';

const PILOT = 90000001;
const ALT = 90000002;
const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
const bob: Actor = { kind: 'account', id: 'bob', instanceRole: 'user' };

describe('SetTracking and ListMapCharacters', () => {
  let clock: ManualClock;
  let tracking: MemoryTrackingRepository;
  let events: MemoryEventLog;
  let setTracking: SetTracking;
  let list: ListMapCharacters;

  beforeEach(() => {
    clock = new ManualClock(1_000);
    tracking = new MemoryTrackingRepository();
    events = new MemoryEventLog();
    const access = fakeAccess({ m1: { alice: 'member', bob: 'viewer' } });
    setTracking = new SetTracking({
      tracking,
      characters: fakeCharacters({
        [PILOT]: { name: 'Pilot', accountId: 'alice' },
        [ALT]: { name: 'Alt', accountId: 'bob' },
      }),
      access,
      events,
      uow: passThroughUow,
      clock,
    });
    list = new ListMapCharacters({ tracking, access });
  });

  it('tracks an own character and announces it on the map', async () => {
    await setTracking.execute(alice, 'm1', { characterId: PILOT, tracked: true });
    expect(tracking.tracked).toEqual([{ mapId: 'm1', characterId: PILOT, accountId: 'alice', since: 1_000 }]);
    const presence = {
      characterId: PILOT,
      accountId: 'alice',
      name: 'Pilot',
      solarSystemId: null,
      shipTypeId: null,
      shipName: null,
      online: false,
      updatedAt: 1_000,
    };
    expect(events.summary()).toEqual([{ type: 'character.tracked', data: presence }]);
    expect(await list.execute(bob, 'm1')).toEqual([presence]);

    // Idempotent.
    await setTracking.execute(alice, 'm1', { characterId: PILOT, tracked: true });
    expect(events.events).toHaveLength(1);
  });

  it('keeps a known presence when tracking starts', async () => {
    await tracking.savePresence({
      characterId: PILOT,
      accountId: 'alice',
      name: 'Pilot',
      solarSystemId: 30000142,
      shipTypeId: 587,
      shipName: 'Rifter',
      online: true,
      updatedAt: 5,
    });
    await setTracking.execute(alice, 'm1', { characterId: PILOT, tracked: true });
    expect(events.events[0]?.data).toMatchObject({ solarSystemId: 30000142, online: true });
  });

  it('untracks and announces it', async () => {
    await setTracking.execute(alice, 'm1', { characterId: PILOT, tracked: true });
    await setTracking.execute(alice, 'm1', { characterId: PILOT, tracked: false });
    expect(tracking.tracked).toEqual([]);
    expect(events.summary().at(-1)).toEqual({ type: 'character.untracked', data: { characterId: PILOT } });
    expect(await list.execute(alice, 'm1')).toEqual([]);
  });

  it('refuses other accounts characters, viewers, strangers and anonymous callers', async () => {
    await expect(setTracking.execute(alice, 'm1', { characterId: ALT, tracked: true })).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
    await expect(setTracking.execute(bob, 'm1', { characterId: ALT, tracked: true })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      setTracking.execute(alice, 'm2', { characterId: PILOT, tracked: true }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      setTracking.execute(null, 'm1', { characterId: PILOT, tracked: true }),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(list.execute(alice, 'm2')).rejects.toMatchObject({ code: 'not_found' });
    expect(events.events).toEqual([]);
  });
});
