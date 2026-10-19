import type { JumpGateUse, JumpHull, JumpLegKind, JumpProblem } from '@darkbeacon/shared';
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
}

export interface PlannedLeg {
  kind: JumpLegKind;
  from: number;
  to: number;
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
}

export interface IgnoredAnsiblex {
  from: number;
  to: number;
  why: string;
}

export type PlanOutcome =
  | { ok: true; rangeLy: number; route: PlannedRoute; ignoredAnsiblex: IgnoredAnsiblex[] }
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
 * Lexicographic cost: stargates, then legs of any kind, then jumps, then stops without a station,
 * then ly, then fatigue. Gates come first so a hull with a jump drive never gates where it could
 * jump: a gate is only for the end of the trip a cyno cannot reach. With `shortcut` gates the
 * first term stays 0, so a gate that saves a jump wins.
 */
type Cost = [gates: number, legs: number, jumps: number, misses: number, ly: number, fatigue: number];

function less(a: Cost, b: Cost): boolean {
  for (let k = 0; k < 6; k++) {
    if (a[k]! < b[k]! - 1e-9) return true;
    if (a[k]! > b[k]! + 1e-9) return false;
  }
  return false;
}

class Heap {
  private readonly items: Array<{ state: number; cost: Cost }> = [];

  get size(): number {
    return this.items.length;
  }

  push(state: number, cost: Cost): void {
    const items = this.items;
    items.push({ state, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i]!.cost, items[parent]!.cost)) break;
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
        if (l < items.length && less(items[l]!.cost, items[m]!.cost)) m = l;
        if (r < items.length && less(items[r]!.cost, items[m]!.cost)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }
}

const KIND_JUMP = 0;
const KIND_GATE = 1;
const KIND_ANSIBLEX = 2;
const KINDS: JumpLegKind[] = ['jump', 'gate', 'ansiblex'];

/**
 * Plans a jump route: fewest stargates (only where no jump reaches, e.g. into high-sec, unless
 * `shortcut` lets a gate save a jump), then fewest legs, then fewest jumps, then
 * (when asked) fewest stops without an NPC station, then the fewest light years (fuel), then the
 * least fatigue. Gates are taken only after the last jump, e.g. into high-sec, so a
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

  if (origin === destination) return fail('same_system', 'Start and destination are the same system');
  if (!hullMayBeIn(space, rules, origin))
    return fail(
      'origin_not_allowed',
      space.zarzakh(origin)
        ? `${HULL_NAMES[ship.hull]} cannot be in Zarzakh`
        : `${HULL_NAMES[ship.hull]} cannot be in high-sec`,
    );
  if (!hullMayBeIn(space, rules, destination) || (outlaw && space.highSec(destination)))
    return fail(
      'destination_not_allowed',
      space.zarzakh(destination)
        ? `${HULL_NAMES[ship.hull]} cannot enter Zarzakh`
        : outlaw && rules.highSec
          ? 'The destination is in high-sec, which outlaw routes never enter'
          : `${HULL_NAMES[ship.hull]} cannot enter high-sec`,
    );

  const avoided = (i: number) =>
    i !== destination && (avoidSystems.has(i) || avoidRegions.has(space.regionId(i)));
  const gateOpen = (u: number, v: number) => {
    if (!hullMayBeIn(space, rules, v)) return false;
    if (outlaw && space.highSec(v)) return false;
    // "Capital ships cannot use stargates" in Pochven.
    if (rules.capital && (space.pochven(u) || space.pochven(v))) return false;
    return !avoided(v);
  };

  // States: system * 2 + phase (0 jumping, 1 finishing over gates).
  const states = space.size * 2;
  const best: Array<Cost | undefined> = new Array(states);
  const prev = new Int32Array(states).fill(-1);
  const prevKind = new Uint8Array(states);
  const done = new Uint8Array(states);
  const heap = new Heap();
  const start = origin * 2;
  best[start] = [0, 0, 0, 0, 0, 0];
  heap.push(start, best[start]!);
  const relax = (from: number, to: number, kind: number, cost: Cost) => {
    const current = best[to];
    if (current && !less(cost, current)) return;
    best[to] = cost;
    prev[to] = from;
    prevKind[to] = kind;
    heap.push(to, cost);
  };

  let reached = -1;
  while (heap.size > 0) {
    const { state, cost } = heap.pop();
    if (done[state]) continue;
    done[state] = 1;
    const u = state >> 1;
    const phase = state & 1;
    if (u === destination) {
      reached = state;
      break;
    }
    if (phase === 0 && canJumpFrom(space, u)) {
      space.within(u, rangeLy, (v, ly) => {
        if (!isCynoTarget(space, v) || avoided(v)) return;
        const miss = options.preferStations && v !== destination && !space.station(v) ? 1 : 0;
        relax(state, v * 2, KIND_JUMP, [
          cost[0],
          cost[1] + 1,
          cost[2] + 1,
          cost[3] + miss,
          cost[4] + ly,
          cost[5] + Math.log1p(ly * ship.fatigueMultiplier),
        ]);
      });
      for (const v of bridges.get(u) ?? []) {
        if (avoided(v)) continue;
        relax(state, v * 2, KIND_ANSIBLEX, [cost[0], cost[1] + 1, cost[2], cost[3], cost[4], cost[5]]);
      }
    }
    if (gates !== 'never') {
      const gatePenalty = gates === 'shortcut' ? 0 : 1;
      for (const v of space.gateNeighbours(u)) {
        if (!gateOpen(u, v)) continue;
        relax(state, v * 2 + 1, KIND_GATE, [
          cost[0] + gatePenalty,
          cost[1] + 1,
          cost[2],
          cost[3],
          cost[4],
          cost[5],
        ]);
      }
    }
  }

  if (reached < 0) {
    const why =
      !isCynoTarget(space, destination) && gates === 'never'
        ? 'No cyno can be lit in the destination; allow gates to finish the trip'
        : `No route within ${rangeLy.toFixed(2)} ly per jump`;
    return fail('no_route', why);
  }

  const steps: Array<{ from: number; to: number; kind: JumpLegKind }> = [];
  for (let s = reached; prev[s]! >= 0; s = prev[s]!) {
    steps.push({ from: prev[s]! >> 1, to: s >> 1, kind: KINDS[prevKind[s]!]! });
  }
  steps.reverse();
  return { ok: true, rangeLy, route: schedule(space, options, rules, steps), ignoredAnsiblex };
}

/** Fuel, waits, fatigue and activation timers along the legs, each leg made as soon as it may be. */
function schedule(
  space: JumpSpace,
  options: PlanOptions,
  rules: HullRules,
  steps: ReadonlyArray<{ from: number; to: number; kind: JumpLegKind }>,
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
  };
}
