import { isWormholeSpace, type RouteNode } from './modes.js';

/** A way home announced is called closed once it has been gone this long. */
export const WATCH_CLOSE_AFTER_MS = 5 * 60_000;
/** The mouth announced last, open again this soon after it closed, is posted without a ping. */
export const WATCH_REPING_MS = 15 * 60_000;

/** A way home measured for a watch: the whole trip and where it leaves known space. */
export interface WatchTrip {
  jumps: number;
  /** Jumps from the watched system to the mouth. */
  gates: number;
  /** Jumps from the mouth to Home. */
  wormholeJumps: number;
  /** The known-space system with the hole into the chain (Home itself when Home is known space). */
  mouthId: number;
}

/**
 * Measures a route from the watched system to Home (`nodes` in that order) against the watch's
 * limit, which counts the whole trip: the gate jumps to the mouth and the wormhole jumps after it.
 * The mouth is the last known-space system before the trip enters the chain for good (Thera on
 * the way does not end the gate part). Null when there is no route or it is too long.
 */
export function watchTrip(
  nodes: ReadonlyArray<Pick<RouteNode, 'id' | 'whClass'>> | null,
  maxJumps: number,
): WatchTrip | null {
  if (!nodes || nodes.length === 0) return null;
  const jumps = nodes.length - 1;
  if (jumps > maxJumps) return null;
  let mouth = 0;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (!isWormholeSpace(node) && node.whClass !== 25) {
      mouth = i;
      break;
    }
  }
  return { jumps, gates: mouth, wormholeJumps: jumps - mouth, mouthId: nodes[mouth]!.id };
}

/** What a watch remembers between looks (persisted, so a restart does not ping again). */
export interface WatchState {
  /** A way home was announced and is not called closed yet. */
  open: boolean;
  /** The mouth announced last (kept after closing, to tell a quick return). */
  mouthId: number | null;
  openSince: number | null;
  /** When the announced way was first missed; null while it stands. */
  missingSince: number | null;
  lastNotifiedAt: number | null;
  closedAt: number | null;
}

export const WAITING: WatchState = {
  open: false,
  mouthId: null,
  openSince: null,
  missingSince: null,
  lastNotifiedAt: null,
  closedAt: null,
};

/**
 * What to tell the pilot: a way opened (`opened`, pinged), moved to another mouth (`moved`,
 * pinged), came back through the mouth announced last within 15 minutes of closing (`again`,
 * posted quietly), or has been gone for five minutes (`closed`, posted quietly).
 */
export type WatchChange = 'opened' | 'moved' | 'again' | 'closed';

/**
 * One look at a watch: the way home found now (its mouth) or none, at `now`. A way that goes
 * missing is only called closed after `WATCH_CLOSE_AFTER_MS`, so a hole re-mapped or a chain
 * redrawn does not post twice; coming back before then says nothing unless the mouth changed.
 */
export function stepWatch(
  state: WatchState,
  found: { mouthId: number } | null,
  now: number,
): { state: WatchState; change: WatchChange | null; closedMouthId?: number } {
  if (found) {
    if (!state.open) {
      const again =
        state.mouthId === found.mouthId && state.closedAt !== null && now - state.closedAt < WATCH_REPING_MS;
      return {
        state: {
          open: true,
          mouthId: found.mouthId,
          openSince: now,
          missingSince: null,
          lastNotifiedAt: now,
          closedAt: state.closedAt,
        },
        change: again ? 'again' : 'opened',
      };
    }
    if (found.mouthId !== state.mouthId) {
      return {
        state: { ...state, mouthId: found.mouthId, missingSince: null, lastNotifiedAt: now },
        change: 'moved',
      };
    }
    return { state: state.missingSince === null ? state : { ...state, missingSince: null }, change: null };
  }
  if (!state.open) return { state, change: null };
  const missingSince = state.missingSince ?? now;
  if (now - missingSince < WATCH_CLOSE_AFTER_MS) {
    return { state: missingSince === state.missingSince ? state : { ...state, missingSince }, change: null };
  }
  return {
    state: { ...state, open: false, openSince: null, missingSince: null, closedAt: now },
    change: 'closed',
    closedMouthId: state.mouthId!,
  };
}
