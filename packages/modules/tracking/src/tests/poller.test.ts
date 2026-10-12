import { ManualClock, type MapRole } from '@darkbeacon/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeAccess,
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
/** First polls at once, no jitter: the tests count exact calls. */
const NO_JITTER = { random: () => 0 };

describe('TrackingPoller', () => {
  let clock: ManualClock;
  let tracking: MemoryTrackingRepository;
  let events: MemoryEventLog;
  let esi: FakeEsi;
  let poller: TrackingPoller;
  let errors: unknown[];
  let roles: Record<string, Record<string, MapRole>>;
  let owners: Record<number, { name: string; accountId: string; token?: string | null }>;

  beforeEach(() => {
    clock = new ManualClock();
    tracking = new MemoryTrackingRepository();
    events = new MemoryEventLog();
    esi = new FakeEsi(5_000, () => clock.now());
    errors = [];
    roles = { m1: { 'acc-1': 'member', 'acc-2': 'member' }, m2: { 'acc-1': 'admin' } };
    owners = {
      [PILOT]: { name: 'Pilot', accountId: 'acc-1' },
      [OTHER]: { name: 'Other', accountId: 'acc-2', token: null },
    };
    poller = new TrackingPoller(
      {
        tracking,
        characters: fakeCharacters(owners),
        access: fakeAccess(roles),
        esi,
        events,
        uow: passThroughUow,
        clock,
        onError: (error) => errors.push(error),
      },
      undefined,
      NO_JITTER,
    );
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
    poller = new TrackingPoller(
      {
        tracking,
        characters: fakeCharacters({ [PILOT]: { name: 'Pilot', accountId: 'acc-1' } }),
        access: fakeAccess(roles),
        esi,
        events,
        uow: passThroughUow,
        clock,
      },
      undefined,
      NO_JITTER,
    );
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
    poller = new TrackingPoller(
      {
        tracking,
        characters: {
          character: (id) => Promise.resolve({ name: 'x', accountId: id === OTHER ? 'acc-2' : 'acc-1' }),
          accessToken: (id) => (id === OTHER ? Promise.reject(new Error('boom')) : Promise.resolve('t')),
        },
        access: fakeAccess(roles),
        esi,
        events,
        uow: passThroughUow,
        clock,
        onError: (error) => errors.push(error),
      },
      undefined,
      NO_JITTER,
    );
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    expect(errors).toHaveLength(1);
    expect(events.summary('map:m1')).toHaveLength(3);
  });

  it('untracks a character that belongs to another account now, without asking ESI', async () => {
    owners[PILOT] = { name: 'Pilot', accountId: 'acc-2' };
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    expect(esi.calls).toEqual([]);
    expect(tracking.tracked).toEqual([]);
    for (const map of ['map:m1', 'map:m2']) {
      expect(events.summary(map)).toEqual([{ type: 'character.untracked', data: { characterId: PILOT } }]);
    }
  });

  it('untracks where the account lost member rights, at once after an access change', async () => {
    roles.m2 = { 'acc-1': 'viewer' };
    esi.set(PILOT, { online: true, location: JITA, ship: 587 });
    await poller.tick();
    expect(tracking.tracked.map((t) => t.mapId)).toEqual(['m1']);
    expect(events.summary('map:m2')).toEqual([{ type: 'character.untracked', data: { characterId: PILOT } }]);

    roles.m1 = {};
    await after(5_000);
    expect(tracking.tracked.map((t) => t.mapId)).toEqual(['m1']); // checked once a minute
    poller.recheckAccess();
    await after(5_000);
    expect(tracking.tracked).toEqual([]);
  });

  describe('at scale', () => {
    const THIRD = 90000003;
    const make = (extra: Partial<ConstructorParameters<typeof TrackingPoller>[0]>, options = {}) =>
      new TrackingPoller(
        {
          tracking,
          characters: fakeCharacters({ ...owners, [THIRD]: { name: 'Third', accountId: 'acc-3' } }),
          access: fakeAccess({ ...roles, m3: { 'acc-3': 'member' } }),
          esi,
          events,
          uow: passThroughUow,
          clock,
          ...extra,
        },
        undefined,
        { ...NO_JITTER, ...options },
      );

    beforeEach(() => {
      tracking.tracked.push({ mapId: 'm3', characterId: THIRD, accountId: 'acc-3', since: 0 });
      esi.set(PILOT, { online: true, location: JITA, ship: 587 });
      esi.set(THIRD, { online: true, location: JITA, ship: 587 });
    });

    it('spreads the first polls after a start over the startup window', async () => {
      poller = make({}, { random: () => 0.5, startupSpreadMs: 10_000 });
      await poller.tick();
      expect(esi.calls).toEqual([]);
      await after(5_000);
      expect(esi.count('online')).toBe(2);
    });

    it('stays within the global budget, characters on viewed maps first', async () => {
      let tokens = 3;
      const budget = {
        tryTake: (cost: number) => (cost <= tokens ? ((tokens -= cost), true) : false),
      };
      poller = make({ budget, viewers: { isViewed: (mapId) => mapId === 'm3' } });
      // Three requests: one character's online, location and ship; the viewed one goes first.
      await poller.tick();
      expect(new Set(esi.calls.map((c) => c.characterId))).toEqual(new Set([THIRD]));
      expect(esi.calls).toHaveLength(3);
      tokens = 3;
      await after(1_000);
      expect(esi.count('online', PILOT)).toBe(1);
    });

    it('never polls one character twice at once, and caps how many are polled together', async () => {
      const release: Array<() => void> = [];
      const slow = { ...esi } as FakeEsi;
      const hold =
        <T>(answer: () => Promise<T>) =>
        () =>
          new Promise<T>((resolve) => release.push(() => void answer().then(resolve)));
      slow.online = (id, token, etag) => hold(() => esi.online(id, token, etag))();
      slow.location = (id, token, etag) => esi.location(id, token, etag);
      slow.ship = (id, token, etag) => esi.ship(id, token, etag);
      poller = make({ esi: slow }, { concurrency: 1 });
      const first = poller.tick();
      await vi.waitFor(() => expect(release).toHaveLength(1));
      // A second tick while the first character still waits on ESI: it is not asked again,
      // and the other one waits for a free slot.
      await poller.tick();
      expect(poller.polling).toBe(1);
      expect(release).toHaveLength(1);
      expect(esi.count('online')).toBe(0);
      // Done with the first, the same worker goes on with the next one due.
      release.shift()!();
      await vi.waitFor(() => expect(release).toHaveLength(1));
      expect(poller.polling).toBe(1);
      release.shift()!();
      await first;
      expect(poller.polling).toBe(0);
      expect(esi.count('online')).toBe(2);
    });

    it('gets through every due character in one tick, however low the concurrency', async () => {
      poller = make({}, { concurrency: 1 });
      await poller.tick();
      expect(esi.count('online')).toBe(2);
      expect(esi.count('location')).toBe(2);
    });

    it('does not touch the database when ESI says nothing changed', async () => {
      poller = make({});
      await poller.tick();
      let reads = 0;
      const getPresence = tracking.getPresence;
      tracking.getPresence = (id) => {
        reads++;
        return getPresence(id);
      };
      for (let i = 0; i < 5; i++) await after(5_000); // all 304s
      expect(esi.count('location')).toBe(12);
      expect(reads).toBe(0);
      esi.set(THIRD, { location: PERIMETER });
      await after(5_000);
      expect(reads).toBe(1);
    });
  });

  it('exposes its intervals', () => {
    expect(POLL_INTERVALS).toMatchObject({ location: 5_000, online: 60_000 });
  });
});
