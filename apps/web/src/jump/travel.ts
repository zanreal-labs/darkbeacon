import { inWormholeSpace, type RouteDto, type RouteStepDto } from '@darkbeacon/shared';
import type { RouteLeg } from './draw';
import type { StarModel } from './model';

/** Thera and Turnur: the hubs of the holes EVE-Scout lists. */
export const THERA = 31000005;
export const TURNUR = 30002086;

/** How a leg of a trip without a jump drive gets to its system. */
export type TravelLegKind = Exclude<RouteLeg['kind'], 'jump'>;

/** A system of such a trip; wormhole space included, so not always on the star map. */
export interface TravelSystem {
  id: number;
  name: string;
  security: number;
  region: string;
  /** SDE wormhole class id and its label ("C3", "Thera"...), as the routing API gives them. */
  whClass: number | null;
  classLabel: string | null;
}

/** One step of the route: a stargate, an Ansiblex bridge, a wormhole, a Thera or Turnur hole. */
export interface TravelLeg {
  kind: TravelLegKind;
  from: TravelSystem;
  to: TravelSystem;
  /** The leg ends at a stop the pilot asked for (not the end of the trip). */
  stop: boolean;
}

/** What the panel and the map say about each kind of leg. */
export const LEG_TAGS: Record<RouteLeg['kind'], string> = {
  jump: 'jump',
  gate: 'gate',
  ansiblex: 'Ansiblex',
  wormhole: 'wormhole',
  thera: 'Thera',
  turnur: 'Turnur',
};

function systemOf(step: RouteStepDto): TravelSystem {
  return {
    id: step.solarSystemId,
    name: step.name,
    security: step.security,
    region: step.regionName ?? '',
    whClass: step.whClass,
    classLabel: step.classLabel,
  };
}

function kindOf(from: RouteStepDto, to: RouteStepDto): TravelLegKind {
  if (to.edge === 'eve-scout') {
    if (from.solarSystemId === THERA || to.solarSystemId === THERA) return 'thera';
    if (from.solarSystemId === TURNUR || to.solarSystemId === TURNUR) return 'turnur';
    return 'wormhole';
  }
  if (to.via === 'bridge') return 'ansiblex';
  if (to.via === 'wormhole') return 'wormhole';
  return 'gate';
}

/**
 * The legs of one route of the routing API (`GET /api/maps/:mapId/route`): one per step after the
 * start. `stop` marks the last leg when the route ends at a stop of the trip.
 */
export function travelLegs(steps: readonly RouteStepDto[], endsAtStop = false): TravelLeg[] {
  const legs: TravelLeg[] = [];
  for (let k = 1; k < steps.length; k++) {
    const from = steps[k - 1]!;
    const to = steps[k]!;
    legs.push({ kind: kindOf(from, to), from: systemOf(from), to: systemOf(to), stop: false });
  }
  if (endsAtStop && legs.length > 0) legs[legs.length - 1]!.stop = true;
  return legs;
}

/**
 * The systems to send as in-game waypoints, in order (the first as the destination, the rest as
 * waypoints). The autopilot flies stargates only: it cannot take a wormhole, a Thera or Turnur
 * hole or an Ansiblex bridge, and cannot route in wormhole space. So the trip goes out as: the
 * system right before each leg that is not a gate (where the pilot takes it over), every stop and
 * the destination; never a system in wormhole space, never the start the pilot sets off from, and
 * no system twice in a row.
 */
export function travelWaypoints(legs: readonly TravelLeg[]): number[] {
  if (legs.length === 0) return [];
  const start = legs[0]!.from.id;
  const out: number[] = [];
  const add = (id: number) => {
    if (inWormholeSpace(id)) return;
    if (out.length === 0 ? id === start : out[out.length - 1] === id) return;
    out.push(id);
  };
  legs.forEach((leg, n) => {
    if (leg.kind !== 'gate') add(leg.from.id);
    if (leg.stop || n === legs.length - 1) add(leg.to.id);
  });
  return out;
}

/** What the trip adds up to: every leg is one jump, and how many of them are not stargates. */
export interface TravelTotals {
  jumps: number;
  gates: number;
  wormholes: number;
  thera: number;
  turnur: number;
  ansiblex: number;
}

export function travelTotals(legs: readonly TravelLeg[]): TravelTotals {
  const totals: TravelTotals = {
    jumps: legs.length,
    gates: 0,
    wormholes: 0,
    thera: 0,
    turnur: 0,
    ansiblex: 0,
  };
  for (const leg of legs) {
    if (leg.kind === 'gate') totals.gates++;
    else if (leg.kind === 'wormhole') totals.wormholes++;
    else if (leg.kind === 'thera') totals.thera++;
    else if (leg.kind === 'turnur') totals.turnur++;
    else totals.ansiblex++;
  }
  return totals;
}

/**
 * The trip as the star map can draw it: known space only. A run of legs through systems the map
 * does not have (wormhole space) is drawn as one leg from the last known system before it to the
 * first one after it, in the kind of the run's first leg that is not a gate. `index[n]` is the drawn
 * leg the trip's leg `n` belongs to (null when it is not drawn).
 */
export function mapLegs(
  legs: readonly TravelLeg[],
  model: StarModel,
): { legs: RouteLeg[]; index: Array<number | null> } {
  const out: RouteLeg[] = [];
  const index: Array<number | null> = [];
  let from: number | null = null;
  let pending: number[] = [];
  let kind: TravelLegKind | null = null;
  for (const [n, leg] of legs.entries()) {
    if (pending.length === 0) from = model.indexById.get(leg.from.id) ?? null;
    pending.push(n);
    if (leg.kind !== 'gate' && kind === null) kind = leg.kind;
    const to = model.indexById.get(leg.to.id);
    if (to === undefined) continue;
    if (from !== null) {
      out.push({ from, to, kind: pending.length === 1 ? leg.kind : (kind ?? 'gate') });
      for (const k of pending) index[k] = out.length - 1;
    } else for (const k of pending) index[k] = null;
    from = to;
    pending = [];
    kind = null;
  }
  for (const k of pending) index[k] = null;
  return { legs: out, index };
}

/** The way between two points of the trip, as far as it is known. */
export type TravelSegment =
  | { status: 'pending' }
  | { status: 'error'; error: Error }
  /** No route satisfies the viewer's route options (`jumps: null`). */
  | { status: 'none' }
  | { status: 'ok'; legs: TravelLeg[] };

export interface TravelPlan {
  /** One per two points of the trip, in order. */
  segments: TravelSegment[];
  /** Every leg of the trip once every segment has its way; null until then. */
  legs: TravelLeg[] | null;
}

/**
 * The trip from the routes between each two of its points: a point that is the one before it (a
 * stop where the trip already is) adds no leg. Every segment but the last ends at a stop.
 */
export function travelPlan(
  answers: ReadonlyArray<{ same: boolean; data: RouteDto | undefined; error: Error | null }>,
): TravelPlan {
  const segments = answers.map((answer, k): TravelSegment => {
    if (answer.same) return { status: 'ok', legs: [] };
    if (answer.data) {
      if (answer.data.jumps === null) return { status: 'none' };
      return { status: 'ok', legs: travelLegs(answer.data.steps, k < answers.length - 1) };
    }
    return answer.error ? { status: 'error', error: answer.error } : { status: 'pending' };
  });
  const done = segments.length > 0 && segments.every((s) => s.status === 'ok');
  return {
    segments,
    legs: done ? segments.flatMap((s) => (s.status === 'ok' ? s.legs : [])) : null,
  };
}
