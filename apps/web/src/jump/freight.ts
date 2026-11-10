/**
 * A freight quote on top of a planned route, as the pilots' own calculator prices a contract
 * (eve-freight-calc.maciag.info.pl, checked 2026-11-09): the fuel at the hub price with a markup,
 * a share of the collateral, and optional base, per m³ and per jump fees; never under a minimum.
 */
export interface FreightTerms {
  /** Cargo volume (m³). */
  cargoM3: number;
  /** Collateral of the contract (ISK). */
  collateral: number;
  /** Fuel markup (% of the fuel cost). */
  markupPct: number;
  /** Collateral fee (% of the collateral). */
  collateralPct: number;
  /** Flat reward (ISK). */
  baseReward: number;
  /** Reward per m³ of cargo (ISK). */
  perM3: number;
  /** Fee per jump (ISK). */
  perJump: number;
  /** The quote is never lower than this (ISK). */
  minReward: number;
}

export const DEFAULT_FREIGHT: FreightTerms = {
  cargoM3: 0,
  collateral: 0,
  markupPct: 20,
  collateralPct: 1,
  baseReward: 0,
  perM3: 0,
  perJump: 0,
  minReward: 0,
};

/** One unit of any isotope takes 0.03 m³ of cargo (or fuel bay). */
export const ISOTOPE_M3 = 0.03;

export interface FreightQuote {
  fuelCost: number;
  /** Space the route's isotopes take (m³). */
  fuelM3: number;
  /** What to ask for the contract. */
  charge: number;
  /** The charge less the fuel cost. */
  margin: number;
  /** The minimum reward set the charge. */
  atMinimum: boolean;
}

export function freightQuote(
  route: { fuel: number; jumps: number },
  pricePerUnit: number,
  terms: FreightTerms,
): FreightQuote {
  const fuelCost = route.fuel * pricePerUnit;
  const priced =
    terms.baseReward +
    terms.perM3 * terms.cargoM3 +
    fuelCost * (1 + terms.markupPct / 100) +
    terms.collateral * (terms.collateralPct / 100) +
    terms.perJump * route.jumps;
  const charge = Math.max(priced, terms.minReward);
  return {
    fuelCost,
    fuelM3: route.fuel * ISOTOPE_M3,
    charge,
    margin: charge - fuelCost,
    atMinimum: terms.minReward > priced,
  };
}

/** ISK as pilots type it: "1.5b", "250m", "40k", "1,000,000", "2 500". Null when it is not a number. */
export function parseIsk(text: string): number | null {
  const match = /^\s*([\d\s.,_]*\d(?:[.,]\d+)?)\s*([kmb]?)\s*(?:isk)?\s*$/i.exec(text);
  if (!match) return null;
  const suffix = match[2]!.toLowerCase();
  let digits = match[1]!.replace(/[\s_]/g, '');
  // A comma before the last three digits is a thousands separator; otherwise a decimal one.
  digits = suffix ? digits.replace(',', '.') : digits.replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const value = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return value * (suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1);
}

/** Terms from storage: every field a finite, non-negative number, else the default. */
export function freightTermsFrom(raw: unknown): FreightTerms {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const terms = { ...DEFAULT_FREIGHT };
  for (const key of Object.keys(DEFAULT_FREIGHT) as Array<keyof FreightTerms>) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) terms[key] = value;
  }
  return terms;
}
