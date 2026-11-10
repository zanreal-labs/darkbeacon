import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import type { JumpFuelHub, JumpPlanInput, JumpShareCreatedDto, JumpShareViewDto } from '@darkbeacon/shared';
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
  ): Promise<JumpShareCreatedDto> {
    const account = requireAccount(actor);
    // A request the planner refuses (unknown ship or systems) is never kept.
    this.deps.planner.planRequest(request);
    const token = this.deps.token();
    await this.deps.store.save({
      token,
      request,
      fuelHub,
      createdBy: account.id,
      createdAt: this.deps.clock.now(),
    });
    return { token };
  }

  /** What a visitor sees; null for a token nobody shared. */
  async view(token: string): Promise<JumpShareViewDto | null> {
    const share = await this.deps.store.find(token);
    if (!share) return null;
    const plan = this.deps.planner.planRequest(share.request);
    const fuelPrices = await this.deps.fuel.at(share.fuelHub).catch(() => null);
    return {
      request: share.request,
      plan,
      fuelPrices,
      universeVersion: this.deps.planner.version,
      sharedAt: share.createdAt,
    };
  }
}
