import { describe, expect, it } from 'vitest';
import { formatIsk, ago, groupLabel } from './intel';
import { massText, staticFacts } from './wormholes';

describe('static facts', () => {
  it('says where a static leads, its mass, what fits and how long it lives', () => {
    expect(
      staticFacts('D845', {
        code: 'D845',
        destination: 'hs',
        targetClass: 7,
        lifetimeHours: 24,
        totalMass: 5_000_000_000,
        maxJumpMass: 375_000_000,
        massRegeneration: 0,
        fits: ['frigate', 'cruiser', 'battleship'],
        shipSize: 'large',
      }).split('\n'),
    ).toEqual([
      'Static D845 to HS',
      'Mass: 5,000M kg in total',
      'Per jump: up to 375M kg (Battleships fit)',
      'Lifetime: 24 h',
    ]);
    expect(staticFacts('X877', undefined)).toBe('Static X877');
    expect(massText(20_000_000)).toBe('20M kg');
  });
});

describe('intel words', () => {
  it('writes ISK, ages and groups as people say them', () => {
    expect([1_250_000_000, 12_000_000_000, 350_000_000, 4_900_000, 10_000, null].map(formatIsk)).toEqual([
      '1.3b',
      '12b',
      '350m',
      '4.9m',
      '10k',
      '',
    ]);
    const now = Date.UTC(2026, 9, 12, 14);
    expect(
      [now - 20_000, now - 5 * 60_000, now - 3 * 3_600_000, now - 50 * 3_600_000].map((t) => ago(t, now)),
    ).toEqual(['now', '5m', '3h', '2d']);
    expect(groupLabel({ id: 1, name: 'Goonswarm Federation', ticker: 'CONDI' })).toBe('[CONDI]');
    expect(groupLabel({ id: 1, name: 'No Ticker Yet', ticker: null })).toBe('No Ticker Yet');
    expect(groupLabel(null, 'pilots')).toBe('pilots');
  });
});
