import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import type { JumpFuelHub, JumpFuelPricesDto } from '@darkbeacon/shared';
import { FUEL_HUBS, ISOTOPE_TYPE_IDS, type Isotope } from '../domain/index.js';
import type { FuelMarket } from '../ports/index.js';

const ISOTOPES = Object.keys(ISOTOPE_TYPE_IDS) as Isotope[];

/**
 * What a route's isotopes cost at a trade hub: the lowest sell order of each isotope at the hub
 * station, as a pilot buying there pays. An isotope the market could not price is null.
 */
export class FuelPrices {
  constructor(private readonly deps: { market: FuelMarket; clock: Clock }) {}

  async prices(actor: Actor | null, hub: JumpFuelHub): Promise<JumpFuelPricesDto> {
    requireAccount(actor);
    return this.at(hub);
  }

  /** The prices for anyone (a shared route's page). */
  async at(hub: JumpFuelHub): Promise<JumpFuelPricesDto> {
    const { station, stationName, region } = FUEL_HUBS[hub];
    const answers = await Promise.all(
      ISOTOPES.map((isotope) =>
        this.deps.market.lowestSell(region, station, ISOTOPE_TYPE_IDS[isotope]).catch(() => null),
      ),
    );
    const prices = Object.fromEntries(ISOTOPES.map((isotope, n) => [isotope, answers[n] ?? null]));
    return {
      hub,
      station: stationName,
      prices: prices as JumpFuelPricesDto['prices'],
      fetchedAt: this.deps.clock.now(),
    };
  }
}
