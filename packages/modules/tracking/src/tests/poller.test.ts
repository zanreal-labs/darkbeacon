import { ManualClock } from '@wormwright/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fakeCharacters,
  FakeEsi,
  MemoryEventLog,
  MemoryTrackingRepository,
  passThroughUow,
} from '../test-support.js';
import { POLL_INTERVALS, TrackingPoller } from '../application/poller.js';

const JITA = 30000142;
const PERIMETER = 30000144;
const J_SPACE = 31000001;
const PILOT = 90000001;
const OTHER = 90000002;

describe('TrackingPoller', () => {
  let clock: ManualClock;
  let tracking: MemoryTrackingRepository;
  let events: MemoryEventLog;
  let esi: FakeEsi;
  let poller: TrackingPoller;
  let errors: unknown[];

  beforeEach(() => {
    clock = new ManualClock();
    tracking = new MemoryTrackingRepository();
    events = new MemoryEventLog();
    esi = new FakeEsi(5_000, () => clock.now());
    errors = [];
    poller = new TrackingPoller({
      tracking,
      characters: fakeCharacters({
        [PILOT]: { name: 'Pilot', accountId: 'acc-1' },
        [OTHER]: { name: 'Other', accountId: 'acc-2', token: null },
      }),
      esi,
      events,
      uow: passThroughUow,
      clock,
      onError: (error) => errors.push(error),
    });
    tracking.tracked = [
      { mapId: 'm1', characterId: PILOT, accountId: 'acc-1', since: 0 },
      { mapId: 'm2', characterId: PILOT, accountId: 'acc-1', since: 0 },
    ];
  });

  const after = async (ms: number) => {
    clock.advance(ms);
    await poller.tick();
  };

  it('emits the first observation on every map tracking the character', async () => {
    esi.set(PILOT, { online: true, location: JITA, ship: 587, shipName: 'Rifter' });
    await poller.tick();

    const expected = [
      { type: 'character.online_changed', data: { characterId: PILOT, online: true } },
      { type: 'character.ship_changed', data: { characterId: PILOT, shipTypeId: 587, shipName: 'Rifter' } },
      { type: 'character.moved', data: { characterId: PILOT, from: null, to: JITA } },
    ];
    expect(events.summary('map:m1')).toEqual(expected);
    expect(events.summary('map:m2')).toEqual(expected);
    expect(await tracking.getPresence(PILOT)).toMatchObject({
      name: 'Pilot',
      accountId: 'acc-1',
      solarSystemId: JITA,
      online: true,
    });
  });

  it('polls location every 5 s, online every 60 s, with ETags', async () => {
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    await after(1_000); // not due yet
    expect([esi.count('location'), esi.count('online')]).toEqual([1, 1]);

    await after(4_000);
    expect([esi.count('location'), esi.count('ship'), esi.count('online')]).toEqual([2, 2, 1]);
    expect(esi.calls.at(-1)?.etag).toBeDefined();
    expect(events.summary('map:m1')).toHaveLength(3); // 304s change nothing

    for (let i = 0; i < 11; i++) await after(5_000);
    expect(esi.count('online')).toBe(2);
    expect(esi.count('location')).toBe(13);
  });

  it('honours Expires when it is later than the poll interval', async () => {
    esi = new FakeEsi(30_000, () => clock.now());
    poller = new TrackingPoller({
      tracking,
      characters: fakeCharacters({ [PILOT]: { name: 'Pilot', accountId: 'acc-1' } }),
      esi,
      events,
      uow: passThroughUow,
      clock,
    });
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    await after(10_000);
    expect(esi.count('location')).toBe(1);
    await after(20_000);
    expect(esi.count('location')).toBe(2);
  });

  it('reports a jump between consecutive polls and only a move after a gap', async () => {
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    esi.set(PILOT, { location: PERIMETER });
    await after(5_000);
    expect(events.summary('map:m1').slice(-2)).toEqual([
      { type: 'character.moved', data: { characterId: PILOT, from: JITA, to: PERIMETER } },
      { type: 'character.jumped', data: { characterId: PILOT, from: JITA, to: PERIMETER, shipTypeId: 587 } },
    ]);

    // ESI refuses for a while; the next answer may hide several jumps.
    esi.answers.location.set(PILOT, { ok: false, retryAt: clock.now() + 60_000, reason: 'HTTP 503' });
    await after(5_000);
    esi.set(PILOT, { location: J_SPACE });
    await after(60_000);
    expect(events.summary('map:m1').at(-1)).toEqual({
      type: 'character.moved',
      data: { characterId: PILOT, from: PERIMETER, to: J_SPACE },
    });
  });

  it('does not poll location while the character is offline', async () => {
    esi.set(PILOT, { online: false, location: JITA, ship: 587 });
    await poller.tick();
    for (let i = 0; i < 6; i++) await after(5_000);
    expect(esi.count('location')).toBe(0);

    esi.set(PILOT, { online: true });
    await after(30_000);
    expect(esi.count('online')).toBe(2);
    expect(esi.count('location')).toBe(1);
  });

  it('waits until retryAt when ESI refuses', async () => {
    esi.answers.online.set(PILOT, { ok: false, retryAt: clock.now() + 120_000, reason: 'error limited' });
    await poller.tick();
    await after(60_000);
    expect(esi.count('online')).toBe(1);
    await after(60_000);
    expect(esi.count('online')).toBe(2);
  });

  it('polls only tracked characters and skips those without a token', async () => {
    tracking.tracked.push({ mapId: 'm1', characterId: OTHER, accountId: 'acc-2', since: 0 });
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    expect(esi.calls.every((c) => c.characterId === PILOT)).toBe(true);

    tracking.tracked = [];
    await after(60_000);
    expect(esi.calls).toHaveLength(3);
  });

  it('keeps going when one character fails', async () => {
    tracking.tracked.push({ mapId: 'm1', characterId: OTHER, accountId: 'acc-2', since: 0 });
    poller = new TrackingPoller({
      tracking,
      characters: {
        character: () => Promise.resolve(null),
        accessToken: (id) => (id === OTHER ? Promise.reject(new Error('boom')) : Promise.resolve('t')),
      },
      esi,
      events,
      uow: passThroughUow,
      clock,
      onError: (error) => errors.push(error),
    });
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    expect(errors).toHaveLength(1);
    expect(events.summary('map:m1')).toHaveLength(3);
  });

  it('exposes its intervals', () => {
    expect(POLL_INTERVALS).toMatchObject({ location: 5_000, online: 60_000 });
  });
});
