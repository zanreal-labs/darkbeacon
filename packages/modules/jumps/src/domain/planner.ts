import type { JumpGateUse, JumpHull, JumpLegKind, JumpProblem, JumpRouteBest } from '@darkbeacon/shared';
import {
  ANSIBLEX_RANGE_LY,
  bridgeFuel,
  fatigueAfterJump,
  jumpFuel,
  jumpRange,
  waitForFatigueCap,
  type JumpSkillLevels,
} from './formulas.js';
import { HULL_RULES, type HullRules } from './hulls.js';
import type { JumpShip, JumpSpace } from './space.js';

/** A plan request with systems as indexes into the space. */
export interface PlanOptions {
  ship: JumpShip;
  origin: number;
  destination: number;
  skills: JumpSkillLevels;
  /** System indexes never stopped at or passed through (the origin and destination excepted). */
  avoidSystems?: ReadonlySet<number>;
  /** Region ids, as `avoidSystems`. */
  avoidRegions?: ReadonlySet<number>;
  preferStations?: boolean;
  gates?: JumpGateUse;
  /** Never enter high-sec (the start may be in it). */
  outlaw?: boolean;
  /** Ansiblex pairs as system indexes; usable both ways. */
  ansiblex?: ReadonlyArray<readonly [number, number]>;
  /** Wait between jumps so fatigue never goes above this many minutes. */
  maxFatigue?: number | null;
  fatigueNow?: number;
  /** Mass bridged on every jump (kg), for titan and black ops bridge fuel. */
  bridgeMassKg?: number | null;
  /** What the route saves first after stargates; `jumps` by default (see `ORDERS`). */
  objective?: RouteObjective;
  /** Systems to stop at on the way, in order (indexes), between the origin and the destination. */
  via?: readonly number[];
  /** Back to the origin after the destination, as one more part of the trip. */
  roundTrip?: boolean;
}

/** What a route is planned to save first: jumps (the recommended one), fuel, or fatigue. */
export type RouteObjective = 'jumps' | 'fuel' | 'fatigue';

export interface PlannedLeg {
  kind: JumpLegKind;
  from: number;
  to: number;
  /** The leg ends at a stop the pilot asked for (not the last system of the trip). */
  stop: boolean;
  ly: number;
  fuel: number;
  bridgeFuel: number | null;
  waitMinutes: number;
  activationMinutes: number;
  fatigueMinutes: number;
}

export interface PlannedRoute {
  legs: PlannedLeg[];
  jumps: number;
  gates: number;
  ansiblex: number;
  ly: number;
  fuel: number;
  bridgeFuel: number | null;
  waitMinutes: number;
  fatigueMinutes: number;
  activationMinutes: number;
  notes: string[];
  /** What this route beats the others of one plan at (`planJumpRoutes`); empty alone. */
  best: JumpRouteBest[];
}

export interface IgnoredAnsiblex {
  from: number;
  to: number;
  why: string;
}

export type PlanOutcome =
  | {
      ok: true;
      rangeLy: number;
      route: PlannedRoute;
      /** Other routes worth a look, each better than `route` at something (`planJumpRoutes`). */
      alternatives: PlannedRoute[];
      ignoredAnsiblex: IgnoredAnsiblex[];
    }
  | {
      ok: false;
      rangeLy: number;
      problem: JumpProblem;
      message: string;
      ignoredAnsiblex: IgnoredAnsiblex[];
    };

const HULL_NAMES: Record<JumpHull, string> = {
  jump_freighter: 'Jump freighters',
  black_ops: 'Black ops',
  rorqual: 'The Rorqual',
  carrier: 'Carriers',
  command_carrier: 'Command carriers',
  dreadnought: 'Dreadnoughts',
  lancer: 'Lancer dreadnoughts',
  force_auxiliary: 'Force auxiliaries',
  supercarrier: 'Supercarriers',
  titan: 'Titans',
};

/** Where a hull may be at all: no capital in high-sec, none in Zarzakh. */
export function hullMayBeIn(space: JumpSpace, rules: HullRules, i: number): boolean {
  if (space.zarzakh(i)) return !rules.capital;
  if (space.highSec(i)) return rules.highSec;
  return true;
}

/**
 * Systems a jump drive can land in: a cynosural field can be lit there. Not high-sec ("Cynos
 * cannot be lit in high-sec"), not Pochven (region-wide cyno jammers; "Jump drives cannot be used
 * to enter Triglavian space"), not Zarzakh (no capitals; jump drives do not work there). Wormhole
 * space is not in the dataset at all ("jump drives cannot jump to systems in wormhole space").
 */
export function isCynoTarget(space: JumpSpace, i: number): boolean {
  return !space.highSec(i) && !space.pochven(i) && !space.zarzakh(i);
}

/** Jump drives work everywhere in known space but Zarzakh (Pochven: "only to exit"). */
export function canJumpFrom(space: JumpSpace, i: number): boolean {
  return !space.zarzakh(i);
}

/**
 * Stargates a `shortcut` route may take after its last jump to save jumps, as in "a system one
 * gate on". Gates beyond these count like `finish` gates: only where no cyno reaches.
 */
export const SHORTCUT_GATES = 3;

/**
 * Cost of a partial route, compared lexicographically in the order of its objective (`ORDERS`).
 * For `jumps`: stargates, then jumps, then stops without a station, then ly (fuel), then legs of
 * any kind, then fatigue. Gates come first in every order so a hull with a jump drive never gates
 * where it could jump: a gate is only for the end of the trip a cyno cannot reach. With `shortcut`
 * gates the first `SHORTCUT_GATES` gates are free, so gates that save a jump win.
 *
 * Jumps come before legs: a jump costs isotopes, fatigue and a cyno, a gate or an Ansiblex bridge
 * costs a minute. Counting them as equals let a longer jump range (Jump Drive Calibration V)
 * trade a few gates for many jumps, a route that cost more fuel and time than the one at IV.
 * Ly before legs, so a free gate that saves isotopes is taken. More range only adds jumps to
 * choose from, so a route never gets worse on any order with it.
 */
type Cost = [gates: number, jumps: number, misses: number, ly: number, legs: number, fatigue: number];

const G = 0;
const J = 1;
const M = 2;
const L = 3;
const N = 4;
const F = 5;

/**
 * Term order per objective. `fuel` takes the fewest light years (isotopes scale with them), at
 * the cost of more jumps; `fatigue` the least fatigue at the end (the sum of log(1 + ly) is the
 * log of how fatigue multiplies), which favours few long jumps.
 */
const ORDERS: Record<RouteObjective, readonly number[]> = {
  jumps: [G, J, M, L, N, F],
  fuel: [G, L, J, M, N, F],
  fatigue: [G, F, J, M, L, N],
};

type Less = (a: Cost, b: Cost) => boolean;

function lessIn(order: readonly number[]): Less {
  return (a, b) => {
    for (const k of order) {
      if (a[k]! < b[k]! - 1e-9) return true;
      if (a[k]! > b[k]! + 1e-9) return false;
    }
    return false;
  };
}

class Heap {
  private readonly items: Array<{ state: number; cost: Cost }> = [];

  constructor(private readonly less: Less) {}

  get size(): number {
    return this.items.length;
  }

  push(state: number, cost: Cost): void {
    const items = this.items;
    items.push({ state, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i]!.cost, items[parent]!.cost)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): { state: number; cost: Cost } {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l]!.cost, items[m]!.cost)) m = l;
        if (r < items.length && this.less(items[r]!.cost, items[m]!.cost)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }
}

interface Step {
  from: number;
  to: number;
  kind: JumpLegKind;
  stop: boolean;
}

const KIND_JUMP = 0;
const KIND_GATE = 1;
const KIND_ANSIBLEX = 2;
const KINDS: JumpLegKind[] = ['jump', 'gate', 'ansiblex'];

/**
 * Plans a jump route: fewest stargates (only where no jump reaches, e.g. into high-sec, unless
 * `shortcut` lets up to `SHORTCUT_GATES` gates save jumps), then fewest jumps, then
 * (when asked) fewest stops without an NPC station, then the fewest light years (fuel), then the
 * fewest legs, then the least fatigue. Gates are taken only after the last jump, e.g. into high-sec, so a
 * route is never a long gate trip with jumps sprinkled in. The schedule (waits, fatigue,
 * activation timers) assumes each leg is made as soon as it may be.
 */
export function planJumpRoute(space: JumpSpace, options: PlanOptions): PlanOutcome {
  const { ship, origin, destination } = options;
  const rules = HULL_RULES[ship.hull];
  const rangeLy = jumpRange(ship.rangeLy, options.skills.jdc);
  const outlaw = options.outlaw ?? false;
  const gates = options.gates ?? 'finish';
  const avoidSystems = options.avoidSystems ?? new Set<number>();
  const avoidRegions = options.avoidRegions ?? new Set<number>();
  const ignoredAnsiblex: IgnoredAnsiblex[] = [];
  const fail = (problem: JumpProblem, message: string): PlanOutcome => ({
    ok: false,
    rangeLy,
    problem,
    message,
    ignoredAnsiblex,
  });

  const bridges = new Map<number, number[]>();
  for (const [a, b] of options.ansiblex ?? []) {
    const ly = space.distance(a, b);
    let why: string | null = null;
    if (!rules.ansiblex) why = `${HULL_NAMES[ship.hull]} cannot use Ansiblex jump bridges`;
    else if (a === b) why = 'Both ends are the same system';
    else if (space.security(a) > 0 || space.security(b) > 0) why = 'Ansiblex bridges stand in null-sec only';
    else if (ly > ANSIBLEX_RANGE_LY) why = `${ly.toFixed(2)} ly apart, more than ${ANSIBLEX_RANGE_LY} ly`;
    if (why) {
      ignoredAnsiblex.push({ from: a, to: b, why });
      continue;
    }
    for (const [u, v] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = bridges.get(u);
      if (list) list.push(v);
      else bridges.set(u, [v]);
    }
  }

  // The trip in parts: origin, the stops, the destination and, for a round trip, the origin again.
  const points = [origin, ...(options.via ?? []), destination, ...(options.roundTrip ? [origin] : [])];
  for (let k = 1; k < points.length; k++)
    if (points[k] === points[k - 1])
      return fail(
        'same_system',
        points.length === 2
          ? 'Start and destination are the same system'
          : `${space.name(points[k]!)} comes twice in a row`,
      );
  if (!hullMayBeIn(space, rules, origin))
    return fail(
      'origin_not_allowed',
      space.zarzakh(origin)
        ? `${HULL_NAMES[ship.hull]} cannot be in Zarzakh`
        : `${HULL_NAMES[ship.hull]} cannot be in high-sec`,
    );
  for (const [k, p] of points.entries()) {
    if (k === 0 || (hullMayBeIn(space, rules, p) && !(outlaw && space.highSec(p)))) continue;
    const what = p === destination ? 'The destination' : `The stop ${space.name(p)}`;
    return fail(
      'destination_not_allowed',
      space.zarzakh(p)
        ? `${HULL_NAMES[ship.hull]} cannot enter Zarzakh`
        : outlaw && rules.highSec
          ? `${what} is in high-sec, which outlaw routes never enter`
          : `${HULL_NAMES[ship.hull]} cannot enter high-sec`,
    );
  }

  // Stops and ends are never avoided: the pilot asked to be there.
  const ends = new Set(points);
  const avoided = (i: number) => !ends.has(i) && (avoidSystems.has(i) || avoidRegions.has(space.regionId(i)));
  const gateOpen = (u: number, v: number) => {
    if (!hullMayBeIn(space, rules, v)) return false;
    if (outlaw && space.highSec(v)) return false;
    // "Capital ships cannot use stargates" in Pochven.
    if (rules.capital && (space.pochven(u) || space.pochven(v))) return false;
    return !avoided(v);
  };

  const less = lessIn(ORDERS[options.objective ?? 'jumps']);
  // States: system * PHASES + phase: 0 jumping, then finishing over gates with 1, 2, ... gates
  // behind, the last phase standing for more than SHORTCUT_GATES.
  const PHASES = SHORTCUT_GATES + 2;
  /** The best legs from one part's start to its end, each part starting with the jump drive ready. */
  const search = (from: number, to: number): Step[] | null => {
    const states = space.size * PHASES;
    const best: Array<Cost | undefined> = new Array(states);
    const prev = new Int32Array(states).fill(-1);
    const prevKind = new Uint8Array(states);
    const done = new Uint8Array(states);
    const heap = new Heap(less);
    const start = from * PHASES;
    best[start] = [0, 0, 0, 0, 0, 0];
    heap.push(start, best[start]!);
    const relax = (fromState: number, toState: number, kind: number, cost: Cost) => {
      const current = best[toState];
      if (current && !less(cost, current)) return;
      best[toState] = cost;
      prev[toState] = fromState;
      prevKind[toState] = kind;
      heap.push(toState, cost);
    };

    let reached = -1;
    while (heap.size > 0) {
      const { state, cost } = heap.pop();
      if (done[state]) continue;
      done[state] = 1;
      const u = Math.floor(state / PHASES);
      const phase = state % PHASES;
      if (u === to) {
        reached = state;
        break;
      }
      if (phase === 0 && canJumpFrom(space, u)) {
        space.within(u, rangeLy, (v, ly) => {
          if (!isCynoTarget(space, v) || avoided(v)) return;
          const miss = options.preferStations && v !== to && !space.station(v) ? 1 : 0;
          relax(state, v * PHASES, KIND_JUMP, [
            cost[0],
            cost[1] + 1,
            cost[2] + miss,
            cost[3] + ly,
            cost[4] + 1,
            cost[5] + Math.log1p(ly * ship.fatigueMultiplier),
          ]);
        });
        for (const v of bridges.get(u) ?? []) {
          if (avoided(v)) continue;
          relax(state, v * PHASES, KIND_ANSIBLEX, [cost[0], cost[1], cost[2], cost[3], cost[4] + 1, cost[5]]);
        }
      }
      if (gates !== 'never') {
        const free = gates === 'shortcut' && phase < SHORTCUT_GATES;
        const next = Math.min(phase + 1, PHASES - 1);
        for (const v of space.gateNeighbours(u)) {
          if (!gateOpen(u, v)) continue;
          relax(state, v * PHASES + next, KIND_GATE, [
            cost[0] + (free ? 0 : 1),
            cost[1],
            cost[2],
            cost[3],
            cost[4] + 1,
            cost[5],
          ]);
        }
      }
    }

    if (reached < 0) return null;
    const steps: Step[] = [];
    for (let s = reached; prev[s]! >= 0; s = prev[s]!) {
      steps.push({
        from: Math.floor(prev[s]! / PHASES),
        to: Math.floor(s / PHASES),
        kind: KINDS[prevKind[s]!]!,
        stop: false,
      });
    }
    return steps.reverse();
  };

  const steps: Step[] = [];
  for (let k = 1; k < points.length; k++) {
    const from = points[k - 1]!;
    const to = points[k]!;
    const part = search(from, to);
    if (!part) {
      const why =
        !isCynoTarget(space, to) && gates === 'never'
          ? `No cyno can be lit in ${points.length === 2 ? 'the destination' : space.name(to)}; allow gates to finish the trip`
          : `No route within ${rangeLy.toFixed(2)} ly per jump`;
      return fail('no_route', points.length === 2 ? why : `${space.name(from)} to ${space.name(to)}: ${why}`);
    }
    // The last leg of every part but the last ends at a stop.
    part[part.length - 1]!.stop = k < points.length - 1;
    steps.push(...part);
  }
  return {
    ok: true,
    rangeLy,
    route: schedule(space, options, rules, steps),
    alternatives: [],
    ignoredAnsiblex,
  };
}

/**
 * What an alternative must save against the recommended route to be shown, as a maps app hides a
 * way that is only a minute shorter: 2 % of the isotopes, or 5 minutes of waiting or fatigue.
 * Fewer jumps than the recommended route there never are.
 */
const WORTH: Record<JumpRouteBest, (alt: PlannedRoute, recommended: PlannedRoute) => boolean> = {
  jumps: () => false,
  fuel: (alt, rec) => alt.fuel <= rec.fuel * 0.98,
  fatigue: (alt, rec) => alt.fatigueMinutes <= rec.fatigueMinutes - 5,
  wait: (alt, rec) => alt.waitMinutes <= rec.waitMinutes - 5,
};

const BEST_OF: Record<JumpRouteBest, (r: PlannedRoute) => number> = {
  jumps: (r) => r.jumps,
  fuel: (r) => r.fuel,
  fatigue: (r) => r.fatigueMinutes,
  wait: (r) => r.waitMinutes,
};

/**
 * The recommended route (fewest jumps) and, as alternatives, the routes that save fuel or fatigue
 * instead, as a maps app offers other ways: the same legs only once, each route tagged with what
 * it beats the others at. Only optimal routes: one another route matches or beats everywhere is
 * dropped, so the recommended route (the first left: fewest jumps, then fuel) is never beaten.
 */
export function planJumpRoutes(space: JumpSpace, options: PlanOptions): PlanOutcome {
  const first = planJumpRoute(space, { ...options, objective: 'jumps' });
  if (!first.ok) return first;
  const routes = [first.route];
  const key = (r: PlannedRoute) => r.legs.map((l) => `${l.kind}:${l.to}`).join(',');
  const seen = new Set([key(first.route)]);
  for (const objective of ['fuel', 'fatigue'] as const) {
    const other = planJumpRoute(space, { ...options, objective });
    if (!other.ok || seen.has(key(other.route))) continue;
    seen.add(key(other.route));
    routes.push(other.route);
  }
  const metrics = Object.entries(BEST_OF) as Array<[JumpRouteBest, (r: PlannedRoute) => number]>;
  // Only optimal routes: one that another beats or ties at everything (stargates too) is never
  // offered, so a preference such as landing at stations cannot recommend a worse route.
  const costs = (r: PlannedRoute) => [r.gates, ...metrics.map(([, of]) => of(r))];
  const beats = (q: PlannedRoute, r: PlannedRoute) => {
    const a = costs(q);
    const b = costs(r);
    return a.every((v, k) => v <= b[k]! + 1e-9) && a.some((v, k) => v < b[k]! - 1e-9);
  };
  // Fewest jumps first (then fuel, fatigue, wait): the recommended route is the first left.
  const optimal = routes
    .filter((r) => !routes.some((q) => q !== r && beats(q, r)))
    .sort((a, b) => {
      const x = costs(a);
      const y = costs(b);
      const k = x.findIndex((v, i) => Math.abs(v - y[i]!) > 1e-9);
      return k < 0 ? 0 : x[k]! - y[k]!;
    });
  const recommended = optimal[0]!;
  // An alternative that saves nothing worth naming against the recommended route is left out.
  const shown = [
    recommended,
    ...optimal.slice(1).filter((r) => metrics.some(([best]) => WORTH[best](r, recommended))),
  ];
  for (const [best, of] of metrics) {
    const least = Math.min(...shown.map(of));
    // Only a difference is worth naming (one route alone ties with itself).
    if (shown.every((r) => of(r) <= least + 1e-9)) continue;
    for (const r of shown) if (of(r) <= least + 1e-9) r.best.push(best);
  }
  const alternatives = shown.slice(1);
  return { ...first, route: recommended, alternatives };
}

/** Fuel, waits, fatigue and activation timers along the legs, each leg made as soon as it may be. */
function schedule(
  space: JumpSpace,
  options: PlanOptions,
  rules: HullRules,
  steps: readonly Step[],
): PlannedRoute {
  const { ship, skills } = options;
  const cap = options.maxFatigue ?? null;
  const bridgeMass =
    rules.bridges && ship.portalMassFactor !== null && options.bridgeMassKg ? options.bridgeMassKg : null;
  const notes: string[] = [];
  let fatigue = Math.max(0, options.fatigueNow ?? 0);
  let activation = 0;
  const legs: PlannedLeg[] = [];
  for (const step of steps) {
    const ly = space.distance(step.from, step.to);
    if (step.kind === 'gate') {
      legs.push({
        ...step,
        ly,
        fuel: 0,
        bridgeFuel: null,
        waitMinutes: 0,
        activationMinutes: activation,
        fatigueMinutes: fatigue,
      });
      continue;
    }
    let wait = activation;
    if (step.kind === 'jump' && cap !== null) {
      const effective = ly * ship.fatigueMultiplier;
      const needed = waitForFatigueCap(fatigue, effective, cap);
      if (needed === null) {
        notes.push(`The jump to ${space.name(step.to)} alone leaves more than ${cap} minutes of fatigue`);
        wait = Math.max(wait, fatigue);
      } else wait = Math.max(wait, needed);
    }
    fatigue = Math.max(0, fatigue - wait);
    activation = 0;
    if (step.kind === 'ansiblex') {
      legs.push({
        ...step,
        ly,
        fuel: 0,
        bridgeFuel: null,
        waitMinutes: wait,
        activationMinutes: 0,
        fatigueMinutes: fatigue,
      });
      continue;
    }
    const after = fatigueAfterJump(fatigue, ly * ship.fatigueMultiplier);
    fatigue = after.fatigue;
    activation = after.activation;
    legs.push({
      ...step,
      ly,
      fuel: jumpFuel(ship.fuelPerLy, ly, skills, rules.jumpFreighterSkill),
      bridgeFuel:
        bridgeMass !== null
          ? bridgeFuel(bridgeMass, ship.portalMassFactor!, ship.fuelPerLy, ly, skills.jfc)
          : null,
      waitMinutes: wait,
      activationMinutes: after.activation,
      fatigueMinutes: after.fatigue,
    });
  }
  const jumps = legs.filter((l) => l.kind === 'jump');
  const last = legs[legs.length - 1];
  return {
    legs,
    jumps: jumps.length,
    gates: legs.filter((l) => l.kind === 'gate').length,
    ansiblex: legs.filter((l) => l.kind === 'ansiblex').length,
    ly: jumps.reduce((sum, l) => sum + l.ly, 0),
    fuel: jumps.reduce((sum, l) => sum + l.fuel, 0),
    bridgeFuel: bridgeMass !== null ? jumps.reduce((sum, l) => sum + (l.bridgeFuel ?? 0), 0) : null,
    waitMinutes: legs.reduce((sum, l) => sum + l.waitMinutes, 0),
    fatigueMinutes: last?.fatigueMinutes ?? fatigue,
    activationMinutes: last?.activationMinutes ?? 0,
    notes,
    best: [],
  };
}
