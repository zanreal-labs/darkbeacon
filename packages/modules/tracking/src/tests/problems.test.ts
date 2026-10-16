import { ManualClock } from '@darkbeacon/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { problemOf, TrackingPoller, type PollProblem } from '../application/poller.js';
import {
  fakeAccess,
  fakeCharacters,
  FakeEsi,
  MemoryEventLog,
  MemoryTrackingProblems,
  MemoryTrackingRepository,
  passThroughUow,
} from '../test-support.js';

const J_SPACE = 31000001;
const PILOT = 90000001;
const NO_JITTER = { random: () => 0 };

describe('what tracking tells the owner when it cannot read a location', () => {
  let clock: ManualClock;
  let esi: FakeEsi;
  let tracking: MemoryTrackingRepository;
  let problems: MemoryTrackingProblems;
  let owners: Record<number, { name: string; accountId: string; token?: string | null }>;
  let reported: Array<[number, PollProblem | null]>;
  let poller: TrackingPoller;

  const makePoller = () =>
    new TrackingPoller(
      {
        tracking,
        characters: fakeCharacters(owners),
        access: fakeAccess({ m1: { alice: 'member' } }),
        esi,
        events: new MemoryEventLog(),
        uow: passThroughUow,
        clock,
        problems,
        onProblem: (id, problem) => reported.push([id, problem]),
      },
      undefined,
      NO_JITTER,
    );

  beforeEach(() => {
    clock = new ManualClock();
    esi = new FakeEsi(5_000, () => clock.now());
    tracking = new MemoryTrackingRepository();
    tracking.tracked = [{ mapId: 'm1', characterId: PILOT, accountId: 'alice', since: 0 }];
    problems = new MemoryTrackingProblems();
    owners = { [PILOT]: { name: 'Pilot', accountId: 'alice' } };
    reported = [];
    poller = makePoller();
  });

  const after = async (ms: number) => {
    clock.advance(ms);
    await poller.tick();
  };

  it('reports a missing scope once, with ESI’s answer, and its end once', async () => {
    esi.set(PILOT, { online: true, ship: 587 });
    esi.answers.location.set(PILOT, { ok: false, retryAt: 0, reason: 'HTTP 403' });
    const since = clock.now();
    await poller.tick();
    await after(5_000);
    await after(5_000);
    expect(reported).toEqual([
      [
        PILOT,
        {
          kind: 'refused',
          message:
            'ESI refused the location (HTTP 403): link the character again so it grants esi-location.read_location.v1.',
        },
      ],
    ]);
    expect(await problems.list([PILOT])).toEqual([
      expect.objectContaining({ characterId: PILOT, kind: 'refused', since }),
    ]);

    esi.set(PILOT, { location: J_SPACE });
    await after(5_000);
    await after(5_000);
    expect(reported.slice(1)).toEqual([[PILOT, null]]);
    expect(await problems.list([PILOT])).toEqual([]);
  });

  it('keeps a refused location while only the online route answers in between', async () => {
    esi.set(PILOT, { online: true, ship: 587 });
    // ESI's gateway asks again about a refused grant only after five minutes.
    esi.answers.location.set(PILOT, { ok: false, retryAt: clock.now() + 300_000, reason: 'HTTP 403' });
    await poller.tick();
    for (let i = 0; i < 4; i++) await after(60_000);
    expect(esi.count('online')).toBeGreaterThan(1);
    expect(reported.map(([, p]) => p?.kind ?? null)).toEqual(['refused']);
    expect(await problems.list([PILOT])).toHaveLength(1);
  });

  it('logs a character without a usable sign-in once, leaving the warning to the expired mark', async () => {
    owners[PILOT]!.token = null;
    await poller.tick();
    await after(60_000);
    expect(reported).toEqual([[PILOT, expect.objectContaining({ kind: 'sign-in' }) as PollProblem]]);
    expect(await problems.list([PILOT])).toEqual([]);
    expect(esi.calls).toEqual([]);
  });

  it('says nothing about a clean start, and clears what an earlier process left', async () => {
    await problems.set({ characterId: PILOT, kind: 'unavailable', message: 'old', since: 1 });
    esi.set(PILOT, { online: false });
    await poller.tick();
    expect(reported).toEqual([]);
    expect(await problems.list([PILOT])).toEqual([]);
  });

  it('keeps the problem while the gateway only paces itself, and drops it when untracked', async () => {
    esi.set(PILOT, { online: true, ship: 587 });
    esi.answers.location.set(PILOT, { ok: false, retryAt: 0, reason: 'rate limited (429)' });
    await poller.tick();
    esi.answers.location.set(PILOT, { ok: false, retryAt: 0, reason: 'rate limited' });
    esi.answers.ship.set(PILOT, { ok: false, retryAt: 0, reason: 'rate limited' });
    await after(5_000);
    expect(reported.map(([, p]) => p?.kind ?? null)).toEqual(['unavailable']);
    expect(await problems.list([PILOT])).toHaveLength(1);

    tracking.tracked = [];
    poller.trackingChanged();
    await after(5_000);
    await Promise.resolve();
    expect(await problems.list([PILOT])).toEqual([]);
  });

  it('names the route and the kind of failure', () => {
    const failed = (reason: string) => ({ ok: false as const, retryAt: 0, reason });
    expect(problemOf('online', failed('HTTP 401'))).toMatchObject({ kind: 'refused' });
    expect(problemOf('ship', failed('error limited (420)'))).toMatchObject({ kind: 'unavailable' });
    expect(problemOf('location', failed('HTTP 503'))).toEqual({
      kind: 'unavailable',
      message: 'ESI did not answer the location (HTTP 503); tracking retries.',
    });
    expect(problemOf('location', failed('rate limited'))).toBe('unknown');
    expect(problemOf('location', { ok: true, data: null, etag: null, expiresAt: 0 })).toBe('ok');
  });
});
