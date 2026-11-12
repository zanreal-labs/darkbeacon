import { describe, expect, it } from 'vitest';
import { DEFAULT_FREIGHT, freightQuote, freightTermsFrom, parseIsk } from './freight';

describe('freightQuote', () => {
  it('matches the pilots calculator: fuel with markup plus the collateral fee', () => {
    // Nomad C-J6MT to Siseide: 92,193 hydrogen at 620 ISK, 20 % markup, 1 % of 1B collateral.
    const quote = freightQuote({ fuel: 92_193, jumps: 4 }, 620, {
      ...DEFAULT_FREIGHT,
      cargoM3: 100_000,
      collateral: 1_000_000_000,
    });
    expect(quote.fuelCost).toBe(57_159_660);
    expect(quote.charge).toBeCloseTo(57_159_660 * 1.2 + 10_000_000, 3);
    expect(quote.margin).toBeCloseTo(quote.charge - 57_159_660, 3);
    expect(quote.fuelM3).toBeCloseTo(2_765.79, 2);
  });

  it('adds the flat, per m³ and per jump fees, and never goes under the minimum', () => {
    const terms = {
      ...DEFAULT_FREIGHT,
      markupPct: 0,
      collateralPct: 0,
      baseReward: 1e6,
      perM3: 100,
      cargoM3: 1000,
      perJump: 5e5,
    };
    expect(freightQuote({ fuel: 0, jumps: 3 }, 600, terms).charge).toBe(1e6 + 1e5 + 1.5e6);
    const floor = freightQuote({ fuel: 0, jumps: 3 }, 600, { ...terms, minReward: 1e7 });
    expect(floor).toMatchObject({ charge: 1e7, atMinimum: true });
  });

  it('adds the low-sec fee once when the route lands in or passes through low-sec', () => {
    const at = (security: number) => ({ security });
    const terms = { ...DEFAULT_FREIGHT, markupPct: 0, collateralPct: 0, lowSecFee: 2e7 };
    const nullSec = {
      fuel: 0,
      jumps: 2,
      legs: [
        { from: at(-0.3), to: at(-0.1) },
        { from: at(-0.1), to: at(-0.5) },
      ],
    };
    const viaLow = {
      ...nullSec,
      legs: [
        { from: at(-0.3), to: at(0.3) },
        { from: at(0.3), to: at(0.4) },
      ],
    };
    expect(freightQuote(nullSec, 600, terms)).toMatchObject({ charge: 0, lowSec: false });
    expect(freightQuote(viaLow, 600, terms)).toMatchObject({ charge: 2e7, lowSec: true });
  });
});

describe('parseIsk', () => {
  it('reads what pilots type', () => {
    expect(parseIsk('1.5b')).toBe(1.5e9);
    expect(parseIsk('250m')).toBe(2.5e8);
    expect(parseIsk('40k')).toBe(4e4);
    expect(parseIsk('1,000,000')).toBe(1e6);
    expect(parseIsk('2 500')).toBe(2500);
    expect(parseIsk('12.5')).toBe(12.5);
    expect(parseIsk('1,5m')).toBe(1.5e6);
    expect(parseIsk('lots')).toBeNull();
    expect(parseIsk('')).toBeNull();
  });
});

describe('freightTermsFrom', () => {
  it('keeps stored numbers and drops the rest', () => {
    expect(freightTermsFrom({ cargoM3: 5000, markupPct: -1, collateral: 'x' })).toEqual({
      ...DEFAULT_FREIGHT,
      cargoM3: 5000,
    });
    expect(freightTermsFrom(null)).toEqual(DEFAULT_FREIGHT);
  });
});
