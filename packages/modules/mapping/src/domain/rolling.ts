import type { MassRange, RollReason, RollResult, RollRisk, RollStepDto } from '@darkbeacon/shared';
import { possibleStatuses } from './mass.js';

/** One ship of the rolling crew, with the mass it puts on the hole cold and hot (kg). */
export interface RollShip {
  /** Position in the crew (a kind sent twice is two ships). */
  index: number;
  shipTypeId: number;
  name: string;
  cold: number;
  hot: number;
}

export interface RollInput {
  /** What may be left of the hole now; null when its type (and so its mass) is unknown. */
  remaining: MassRange | null;
  maxJumpMass: number | null;
  /** Nominal total of the type, for the statuses the hole may show; null when unknown. */
  total: number | null;
  ships: readonly RollShip[];
  /** Round trips at most (a trip is out and back). */
  maxTrips?: number;
}

export interface RollOutcome {
  result: RollResult;
  reason: RollReason;
  steps: RollStepDto[];
}

const MAX_TRIPS = 40;

/**
 * A rolling plan: round trips, each ship out (away from home) and back again, so the hole
 * collapses on a jump home and nobody ends up on the far side. The game counts a ship's mass at
 * the moment it jumps, and a hole that collapses does so behind the ship that closed it, so:
 *
 * - a jump out must never be able to close the hole: it goes cold, and only while the mass on the
 *   hole plus that jump stays under the least the hole may have left (`remaining.min`);
 * - a jump back may close it: it goes hot (prop module running) for the most mass;
 * - trips that stay under that least come first (largest first, and only while the trip with the
 *   heaviest jump back can still go out safely after them), so the mass on the hole creeps up to
 *   it, then that trip; a trip whose jump back reaches the most the hole may have left
 *   (`remaining.max`) closes it whatever its real mass. Trips come in whole ship masses, so the
 *   last safe trip may still fall short of the least and leave a jump out that may close it;
 * - when no jump out is safe any more and the hole may still be open, the ship with the least
 *   mass out for what it brings back goes (a heavy interdiction cruiser out with its mass
 *   entangler on, home hot with it off): that jump may strand it, and the plan says so.
 *
 * A ship that makes two trips in a row jumps the same way within five minutes: the step is marked
 * polarized (the pilot has to wait); ships of one kind take turns to avoid it. Pure function.
 */
export function planRoll(input: RollInput): RollOutcome {
  const { remaining } = input;
  const limit = input.maxJumpMass ?? Infinity;
  if (!remaining) return impossible('unknownType');
  if (input.ships.length === 0) return impossible('noShips');
  const crew = input.ships.filter((s) => s.cold <= limit);
  if (crew.length === 0) return impossible('tooHeavy');
  if (remaining.max <= 0) return impossible('gone');

  const out = (s: RollShip) => s.cold;
  const hotFits = (s: RollShip) => s.hot > s.cold && s.hot <= limit;
  const back = (s: RollShip) => (hotFits(s) ? s.hot : s.cold);
  const collapse = (used: number): RollRisk =>
    used >= remaining.max ? 'will' : used >= remaining.min ? 'may' : 'none';

  const steps: RollStepDto[] = [];
  const lastTrip = new Map<number, number>();
  let used = 0;
  let trip = 0;
  let stranding = false;
  let lastShip: number | null = null;

  /** Best first by `keys` (smaller wins), then a ship that did not make the last trip, then crew order. */
  const pick = (ships: RollShip[], keys: (s: RollShip) => number[]) =>
    [...ships].sort((a, b) => {
      const ka = keys(a);
      const kb = keys(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
      const la = a.index === lastShip ? 1 : 0;
      const lb = b.index === lastShip ? 1 : 0;
      return la - lb || a.index - b.index;
    })[0]!;

  const push = (ship: RollShip, direction: 'out' | 'back', mass: number, hot: boolean) => {
    used += mass;
    const remainingAfter = {
      min: Math.max(0, remaining.min - used),
      max: Math.max(0, remaining.max - used),
    };
    steps.push({
      ship: ship.index,
      shipTypeId: ship.shipTypeId,
      shipName: ship.name,
      direction,
      massMode: hot ? 'hot' : 'cold',
      mass,
      usedAfter: used,
      remainingAfter,
      collapse: collapse(used),
      polarized: lastTrip.get(ship.index) === trip - 1,
      shows: remainingAfter.max > 0 ? possibleStatuses(remainingAfter, input.total) : [],
    });
  };

  const maxTrips = input.maxTrips ?? MAX_TRIPS;
  while (used < remaining.max && trip < maxTrips) {
    const safe = crew.filter((s) => used + out(s) < remaining.min);
    let ship: RollShip;
    let hot = true;
    if (safe.length > 0) {
      const closing = safe.filter((s) => used + out(s) + back(s) >= remaining.max);
      // The trip that will cross into "may close": the heaviest jump back. Fillers come first, but
      // only while that trip's jump out stays safe after them.
      const last = pick(safe, (s) => [-back(s), out(s)]);
      const fillers = safe.filter((s) => used + out(s) + back(s) + out(last) < remaining.min);
      if (closing.length > 0) ship = pick(closing, (s) => [out(s)]);
      else if (fillers.length > 0) ship = pick(fillers, (s) => [-(out(s) + back(s))]);
      else ship = last;
    } else {
      // Every jump out may now close the hole; one that surely would is never planned.
      const possible = crew.filter((s) => used + out(s) < remaining.max);
      if (possible.length === 0) {
        stranding = true;
        break;
      }
      // Each ship may come back hot or cold. A trip must not leave less than the lightest jump
      // out on the hole (only a stranding jump could close it then) unless it closes it.
      const lightest = Math.min(...possible.map(out));
      const trips = possible.flatMap((s) => [
        { s, hot: true, back: back(s) },
        ...(back(s) > s.cold ? [{ s, hot: false, back: s.cold }] : []),
      ]);
      const leaves = (t: (typeof trips)[number]) => remaining.max - (used + out(t.s) + t.back);
      const usable = trips.filter((t) => leaves(t) <= 0 || leaves(t) > lightest);
      // The least mass out for the mass it brings back: each jump out is a chance to strand.
      const chosen = [...(usable.length > 0 ? usable : trips)].sort(
        (a, b) =>
          out(a.s) / (out(a.s) + a.back) - out(b.s) / (out(b.s) + b.back) ||
          Number(b.hot) - Number(a.hot) ||
          out(a.s) - out(b.s) ||
          Number(a.s.index === lastShip) - Number(b.s.index === lastShip) ||
          a.s.index - b.s.index,
      )[0]!;
      ship = chosen.s;
      hot = chosen.hot;
      stranding = true;
    }
    trip += 1;
    push(ship, 'out', out(ship), false);
    if (hot) push(ship, 'back', back(ship), hotFits(ship));
    else push(ship, 'back', ship.cold, false);
    lastTrip.set(ship.index, trip);
    lastShip = ship.index;
  }

  if (steps.length === 0) return { result: 'impossible', reason: 'strand', steps };
  if (used >= remaining.max)
    return stranding
      ? { result: 'risky', reason: 'strand', steps }
      : { result: 'ok', reason: 'collapses', steps };
  return { result: 'risky', reason: stranding ? 'strand' : 'check', steps };
}

function impossible(reason: RollReason): RollOutcome {
  return { result: 'impossible', reason, steps: [] };
}
