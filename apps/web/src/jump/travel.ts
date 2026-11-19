import {
  inWormholeSpace,
  type RouteDto,
  type RouteHoleDto,
  type RouteStepDto,
  type TheraDto,
} from '@darkbeacon/shared';
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
  /** A Thera or Turnur leg: the hole as EVE-Scout listed it (signatures, type, age). */
  hole?: RouteHoleDto;
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
    legs.push({
      kind: kindOf(from, to),
      from: systemOf(from),
      to: systemOf(to),
      stop: false,
      ...(to.hole ? { hole: to.hole } : {}),
    });
  }
  if (endsAtStop && legs.length > 0) legs[legs.length - 1]!.stop = true;
  return legs;
}

/**
 * One part of a trip as the autopilot can fly it: the systems to send, in order (the first as the
 * destination, the rest as waypoints), and the leg the pilot must take by hand where the part ends
 * (a wormhole, a Thera or Turnur hole, an Ansiblex bridge), or null for the last part.
 */
export interface WaypointPart {
  targets: number[];
  /** Where the part ends: the leg taken by hand from its last system; null at the end of the trip. */
  then: TravelLeg | null;
}

/**
 * The trip as in-game waypoints, cut at every leg the autopilot cannot take. The autopilot flies
 * stargates only and does not stop at a waypoint: sent past a hole, it flies on from the system
 * of the hole towards the next waypoint over gates, so when the hole is gone (it collapsed, or
 * EVE-Scout's report was wrong) it turns the pilot round and back the way they came. So each part
 * ends at the system where the pilot takes a hole or bridge (the autopilot stops there, as at a
 * destination); the next part goes out once they are through. A part holds every stop and its
 * end; never a system in wormhole space, never the system it sets off from, no system twice in a
 * row. Parts with nothing to send (a run inside wormhole space) are left out.
 */
export function travelWaypointParts(legs: readonly TravelLeg[]): WaypointPart[] {
  const parts: WaypointPart[] = [];
  let start = legs[0]?.from.id ?? null;
  let out: number[] = [];
  const add = (id: number) => {
    if (inWormholeSpace(id)) return;
    if (out.length === 0 ? id === start : out[out.length - 1] === id) return;
    out.push(id);
  };
  legs.forEach((leg, n) => {
    if (leg.kind !== 'gate') {
      add(leg.from.id);
      if (out.length > 0) parts.push({ targets: out, then: leg });
      out = [];
      start = leg.to.id;
      if (n === legs.length - 1) add(leg.to.id);
      return;
    }
    if (leg.stop || n === legs.length - 1) add(leg.to.id);
  });
  if (out.length > 0) parts.push({ targets: out, then: null });
  return parts;
}

/**
 * What to look for where a part ends, in a line: the kind of leg and, for a Thera or Turnur hole,
 * the signature on this side, its type and size, and how old EVE-Scout's report is.
 */
export function handoverText(leg: TravelLeg, now: number = Date.now()): string {
  const where = leg.from.name;
  if (leg.kind === 'ansiblex') return `Take the Ansiblex in ${where} to ${leg.to.name}.`;
  if (leg.kind === 'wormhole') return `Take the wormhole in ${where} to ${leg.to.name}.`;
  const hub = leg.kind === 'thera' ? 'Thera' : 'Turnur';
  const hole = leg.hole;
  if (!hole) return `Take the ${hub} hole in ${where}.`;
  const farSide = hole.solarSystemId === leg.from.id;
  const sig = farSide ? hole.signature : hole.hubSignature;
  const what = farSide ? `the ${hub} hole in ${where}` : `the hole to ${leg.to.name} in ${where}`;
  const kind = [hole.whType, hole.maxShipSize].filter(Boolean).join(', ');
  const facts = [
    hole.updatedAt !== null ? `reported ${hoursAgo(now - hole.updatedAt)}` : null,
    hole.expiresAt !== null
      ? `about ${Math.max(0, Math.round((hole.expiresAt - now) / 3_600_000))} h left`
      : null,
  ].filter(Boolean);
  return (
    `Take ${what}: signature ${sig ?? 'not given'}${kind ? ` (${kind})` : ''}` +
    `${facts.length > 0 ? `, ${facts.join(', ')}` : ''}. ` +
    `If it is not there, it has closed: plan again from ${where}.`
  );
}

function hoursAgo(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/**
 * The Thera and Turnur holes of the trip that EVE-Scout no longer lists (collapsed, or taken off
 * as wrong): sending a route through them would take the pilot to a hole that is not there.
 */
export function missingHoles(legs: readonly TravelLeg[], feed: TheraDto): TravelLeg[] {
  const listed = new Set(feed.connections.map((c) => c.id));
  return legs.filter((leg) => leg.hole !== undefined && !listed.has(leg.hole.id));
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
