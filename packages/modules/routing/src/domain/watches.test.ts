import { describe, expect, it } from 'vitest';
import {
  stepWatch,
  WAITING,
  WATCH_CLOSE_AFTER_MS,
  WATCH_REPING_MS,
  watchTrip,
  type WatchState,
} from './watches.js';

const k = (id: number) => ({ id, whClass: 7 });
const wh = (id: number) => ({ id, whClass: 3 });
const MIN = 60_000;

describe('measuring a way home for a watch', () => {
  it('counts the whole trip: gates to the mouth, then the wormhole jumps', () => {
    // Amarr, two gates, the mouth, two holes to Home.
    expect(watchTrip([k(1), k(2), k(3), wh(4), wh(5)], 10)).toEqual({
      jumps: 4,
      gates: 2,
      wormholeJumps: 2,
      mouthId: 3,
    });
  });

  it('refuses a trip longer than the limit, however few the gates', () => {
    expect(watchTrip([k(1), k(2), wh(3), wh(4), wh(5)], 3)).toBeNull();
    expect(watchTrip([k(1), k(2), wh(3), wh(4), wh(5)], 4)).toMatchObject({ jumps: 4, gates: 1 });
    expect(watchTrip(null, 10)).toBeNull();
  });

  it('takes the last known-space system before the chain as the mouth, Thera on the way included', () => {
    const thera = { id: 9, whClass: 12 };
    expect(watchTrip([k(1), thera, k(2), wh(3), wh(4)], 10)).toMatchObject({ mouthId: 2, gates: 2 });
    // Already at the mouth: no gates.
    expect(watchTrip([k(1), wh(2)], 10)).toMatchObject({ gates: 0, wormholeJumps: 1, mouthId: 1 });
  });
});

describe('a watch over time', () => {
  const t0 = Date.UTC(2026, 10, 21, 12);
  const open = (state: WatchState, mouthId: number, at: number) => stepWatch(state, { mouthId }, at);

  it('pings when a way opens, says nothing while it stands, pings again for another mouth', () => {
    const first = open(WAITING, 3, t0);
    expect(first.change).toBe('opened');
    const same = open(first.state, 3, t0 + MIN);
    expect(same.change).toBeNull();
    expect(same.state).toBe(first.state);
    const moved = open(same.state, 7, t0 + 2 * MIN);
    expect(moved.change).toBe('moved');
    expect(moved.state.mouthId).toBe(7);
  });

  it('calls a way closed only after five minutes gone; back sooner, nothing is said', () => {
    const opened = open(WAITING, 3, t0).state;
    const missing = stepWatch(opened, null, t0 + MIN);
    expect(missing.change).toBeNull();
    expect(missing.state.missingSince).toBe(t0 + MIN);
    const back = open(missing.state, 3, t0 + 4 * MIN);
    expect(back.change).toBeNull();
    expect(back.state.missingSince).toBeNull();

    const gone = stepWatch(back.state, null, t0 + 5 * MIN);
    expect(stepWatch(gone.state, null, t0 + 5 * MIN + WATCH_CLOSE_AFTER_MS - 1).change).toBeNull();
    const closed = stepWatch(gone.state, null, t0 + 5 * MIN + WATCH_CLOSE_AFTER_MS);
    expect(closed).toMatchObject({ change: 'closed', closedMouthId: 3, state: { open: false } });
    // Closed and still gone: quiet.
    expect(stepWatch(closed.state, null, t0 + 30 * MIN).change).toBeNull();
  });

  it('the same mouth back within 15 minutes of closing comes back quietly; later it pings', () => {
    const opened = open(WAITING, 3, t0).state;
    const missing = stepWatch(opened, null, t0).state;
    const closedAt = t0 + WATCH_CLOSE_AFTER_MS;
    const closed = stepWatch(missing, null, closedAt).state;
    expect(open(closed, 3, closedAt + WATCH_REPING_MS - 1).change).toBe('again');
    expect(open(closed, 3, closedAt + WATCH_REPING_MS).change).toBe('opened');
    expect(open(closed, 8, closedAt + MIN).change).toBe('opened');
  });

  it('a never-opened watch with no way stays quiet', () => {
    expect(stepWatch(WAITING, null, t0)).toEqual({ state: WAITING, change: null });
  });
});
