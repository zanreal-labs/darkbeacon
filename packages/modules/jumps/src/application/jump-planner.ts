import { requireAccount, ValidationError, type Actor } from '@darkbeacon/core';
import type {
  JumpMetaDto,
  JumpPlanDto,
  JumpPlanInput,
  JumpRouteDto,
  JumpShipDto,
  JumpSystemRefDto,
  JumpUniverseDto,
} from '@darkbeacon/shared';
import {
  ANSIBLEX_RANGE_LY,
  HULL_RULES,
  JumpSpace,
  planJumpRoutes,
  RANGE_BONUS_PER_LEVEL,
  type JumpShip,
  type PlannedRoute,
} from '../domain/index.js';
import type { JumpSpaceSource } from '../ports/index.js';

/** Ships and hulls in the order the picker lists them: hull class, then name. */
const HULL_ORDER = Object.keys(HULL_RULES);

/** The jump planner's queries: ships, the k-space map and routes. */
export class JumpPlanner {
  private readonly space: JumpSpace;
  private readonly ships: JumpShipDto[];
  private universeDto: JumpUniverseDto | null = null;

  constructor(private readonly source: JumpSpaceSource) {
    this.space = new JumpSpace(source.data);
    this.ships = [...this.space.ships]
      .sort((a, b) => HULL_ORDER.indexOf(a.hull) - HULL_ORDER.indexOf(b.hull) || a.name.localeCompare(b.name))
      .map(shipDto);
  }

  get version(): string {
    return this.source.version;
  }

  meta(actor: Actor | null): JumpMetaDto {
    requireAccount(actor);
    return {
      version: this.source.version,
      source: this.source.data.source,
      ships: this.ships,
      rangeBonusPerLevel: RANGE_BONUS_PER_LEVEL,
      ansiblexRangeLy: ANSIBLEX_RANGE_LY,
    };
  }

  /** The map's data: the dataset without its ships (they are in `meta`). */
  universe(actor: Actor | null): JumpUniverseDto {
    requireAccount(actor);
    return this.universeData();
  }

  /** The map's data for anyone (a shared route's page); the same dataset as `universe`. */
  universeData(): JumpUniverseDto {
    this.universeDto ??= {
      version: this.source.version,
      source: this.source.data.source,
      regions: [...this.source.data.regions],
      systems: {
        id: [...this.source.data.systems.id],
        name: [...this.source.data.systems.name],
        region: [...this.source.data.systems.region],
        security: [...this.source.data.systems.security],
        x: [...this.source.data.systems.x],
        y: [...this.source.data.systems.y],
        z: [...this.source.data.systems.z],
        flags: [...this.source.data.systems.flags],
      },
      gates: [...this.source.data.gates],
    };
    return this.universeDto;
  }

  plan(actor: Actor | null, request: JumpPlanInput): JumpPlanDto {
    requireAccount(actor);
    return this.planRequest(request);
  }

  /** A plan without an actor: for a shared route, whose request was checked when it was shared. */
  planRequest(request: JumpPlanInput): JumpPlanDto {
    const space = this.space;
    const ship = space.ship(request.shipTypeId);
    if (!ship) throw new ValidationError('That ship has no jump drive');
    const index = (id: number, what: string) => {
      const i = space.indexOf(id);
      if (i === undefined) throw new ValidationError(`${what} is not a known-space system the planner knows`);
      return i;
    };
    const origin = index(request.origin, 'The start');
    const destination = index(request.destination, 'The destination');
    const via = request.via.map((id) => index(id, 'A stop'));
    const known = (ids: readonly number[]) => ids.flatMap((id) => space.indexOf(id) ?? []);
    const outcome = planJumpRoutes(space, {
      ship,
      origin,
      destination,
      via,
      roundTrip: request.roundTrip,
      skills: request.skills,
      avoidSystems: new Set(known(request.avoidSystems)),
      avoidRegions: new Set(request.avoidRegions),
      preferStations: request.preferStations,
      gates: request.gates,
      outlaw: request.outlaw,
      ansiblex: request.ansiblex.flatMap(({ from, to }) => {
        const a = space.indexOf(from);
        const b = space.indexOf(to);
        return a === undefined || b === undefined ? [] : [[a, b] as const];
      }),
      maxFatigue: request.maxFatigueMinutes,
      fatigueNow: request.fatigueNowMinutes,
      bridgeMassKg: request.bridgeTonnes === null ? null : request.bridgeTonnes * 1000,
    });
    const ref = (i: number): JumpSystemRefDto => ({
      id: space.id(i),
      name: space.name(i),
      security: space.security(i),
      region: space.regionNameOf(i),
      station: space.station(i),
    });
    const ignoredAnsiblex = outcome.ignoredAnsiblex.map((x) => ({
      from: space.id(x.from),
      to: space.id(x.to),
      why: x.why,
    }));
    if (!outcome.ok) {
      return {
        ship: shipDto(ship),
        rangeLy: outcome.rangeLy,
        route: null,
        alternatives: [],
        problem: { code: outcome.problem, message: outcome.message },
        ignoredAnsiblex,
      };
    }
    const routeDto = (r: PlannedRoute): JumpRouteDto => ({
      legs: r.legs.map((leg) => ({
        kind: leg.kind,
        from: ref(leg.from),
        to: ref(leg.to),
        stop: leg.stop,
        ly: round(leg.ly, 3),
        fuel: leg.fuel,
        bridgeFuel: leg.bridgeFuel,
        waitMinutes: round(leg.waitMinutes, 1),
        activationMinutes: round(leg.activationMinutes, 1),
        fatigueMinutes: round(leg.fatigueMinutes, 1),
      })),
      jumps: r.jumps,
      gates: r.gates,
      ansiblex: r.ansiblex,
      ly: round(r.ly, 3),
      fuel: r.fuel,
      bridgeFuel: r.bridgeFuel,
      waitMinutes: round(r.waitMinutes, 1),
      fatigueMinutes: round(r.fatigueMinutes, 1),
      activationMinutes: round(r.activationMinutes, 1),
      notes: r.notes,
      best: r.best,
    });
    return {
      ship: shipDto(ship),
      rangeLy: outcome.rangeLy,
      route: routeDto(outcome.route),
      alternatives: outcome.alternatives.map(routeDto),
      problem: null,
      ignoredAnsiblex,
    };
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function shipDto(ship: JumpShip): JumpShipDto {
  const rules = HULL_RULES[ship.hull];
  return {
    typeId: ship.typeId,
    name: ship.name,
    hull: ship.hull,
    rangeLy: ship.rangeLy,
    fuelPerLy: ship.fuelPerLy,
    isotope: ship.isotope,
    fatigueMultiplier: ship.fatigueMultiplier,
    mass: ship.mass,
    bridges: rules.bridges && ship.portalMassFactor !== null,
    highSec: rules.highSec,
    ansiblex: rules.ansiblex,
    cyno: rules.cyno,
  };
}
