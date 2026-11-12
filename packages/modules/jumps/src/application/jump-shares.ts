import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import {
  jumpRouteKey,
  type JumpFuelHub,
  type JumpPlanDto,
  type JumpPlanInput,
  type JumpRouteDto,
  type JumpShareCreatedDto,
  type JumpShareFreight,
  type JumpShareViewDto,
} from '@darkbeacon/shared';
import type { JumpShareStore } from '../ports/index.js';
import type { FuelPrices } from './fuel-prices.js';
import type { JumpPlanner } from './jump-planner.js';

/**
 * Jump routes shared as a link (`/j/<token>`) anyone can open without signing in, to plan jumps
 * together: the plan request is kept as it was (ship, ends, stops, skill levels, options) and the
 * route is planned again from it on every visit. Nothing about the account or its characters is
 * kept or shown; the levels and fatigue are the numbers the sharer planned with.
 */
export class JumpShares {
  constructor(
    private readonly deps: {
      store: JumpShareStore;
      planner: JumpPlanner;
      fuel: FuelPrices;
      clock: Clock;
      /** A fresh unguessable token (at least 128 bits). */
      token(): string;
    },
  ) {}

  async share(
    actor: Actor | null,
    request: JumpPlanInput,
    fuelHub: JumpFuelHub,
    options: { route?: string | null; freight?: JumpShareFreight | null } = {},
  ): Promise<JumpShareCreatedDto> {
    const account = requireAccount(actor);
    // A request the planner refuses (unknown ship or systems) is never kept.
    this.deps.planner.planRequest(request);
    const token = this.deps.token();
    await this.deps.store.save({
      token,
      request,
      fuelHub,
      route: options.route ?? null,
      freight: options.freight ?? null,
      createdBy: account.id,
      createdAt: this.deps.clock.now(),
    });
    return { token };
  }

  /** What a visitor sees; null for a token nobody shared. */
  async view(token: string): Promise<JumpShareViewDto | null> {
    const share = await this.deps.store.find(token);
    if (!share) return null;
    const planned = this.deps.planner.planRequest(share.request);
    // The route the sharer looked at, if it is still among those planned; else the recommended.
    const chosen =
      [planned.route, ...(planned.alternatives ?? [])].find(
        (r): r is JumpRouteDto => r !== null && share.route !== null && jumpRouteKey(r) === share.route,
      ) ?? planned.route;
    const plan: JumpPlanDto = { ...planned, route: chosen, alternatives: [] };
    // A client's freight quote shows the route and the price, never what the fuel costs.
    if (share.freight)
      return {
        request: share.request,
        plan: withoutFuel(plan),
        freight: share.freight,
        fuelPrices: null,
        universeVersion: this.deps.planner.version,
        sharedAt: share.createdAt,
      };
    const fuelPrices = await this.deps.fuel.at(share.fuelHub).catch(() => null);
    return {
      request: share.request,
      plan,
      freight: null,
      fuelPrices,
      universeVersion: this.deps.planner.version,
      sharedAt: share.createdAt,
    };
  }
}

/** The plan with every fuel figure taken out (a client's freight quote does not show them). */
function withoutFuel(plan: JumpPlanDto): JumpPlanDto {
  const route = plan.route;
  if (!route) return plan;
  return {
    ...plan,
    route: {
      ...route,
      fuel: 0,
      bridgeFuel: route.bridgeFuel === null ? null : 0,
      legs: route.legs.map((leg) => ({ ...leg, fuel: 0, bridgeFuel: leg.bridgeFuel === null ? null : 0 })),
    },
  };
}
