import { describe, expect, it } from 'vitest';
import { WORMHOLE_SPAWNS } from '@darkbeacon/shared';
import { wormholeCatalogFixture } from '../test/wormholes';
import {
  DEFAULT_FILTER,
  filterRows,
  firstSort,
  lifetimeText,
  nextSort,
  referenceRows,
  sizeHint,
  sizeLegend,
  sortRows,
  tonnes,
} from './rows';

const catalog = wormholeCatalogFixture();
const rows = referenceRows(catalog.types);
const codes = (list: { code: string }[]) => list.map((r) => r.code);

describe('wormhole types reference rows', () => {
  it('lists every type of the catalog, K162 included, with its spawn data', () => {
    expect(rows).toHaveLength(catalog.types.length);
    // Spawns and respawn come from the EVE University tables, which lack the two newest
    // Pochven types; the SDE has their numbers.
    const unlisted = rows.filter((r) => r.code !== 'K162' && !WORMHOLE_SPAWNS[r.code]);
    expect(codes(unlisted)).toEqual(['O753', 'R327']);
    expect(unlisted.every((r) => r.spawnsIn.length === 0 && r.respawn.length === 0)).toBe(true);
    expect(unlisted.every((r) => r.destination === 'pochven' && r.maxJumpMass === 375_000_000)).toBe(true);
    expect(rows.find((r) => r.code === 'C247')).toEqual({
      code: 'C247',
      destination: 'c3',
      spawnsIn: ['c4'],
      respawn: ['static'],
      lifetimeHours: 16,
      totalMass: 2_000_000_000,
      maxJumpMass: 375_000_000,
      massRegeneration: 0,
      size: 'large',
      fits: [
        'frigate',
        'destroyer',
        'cruiser',
        'battlecruiser',
        'industrial',
        'battleship',
        'industrialCommand',
      ],
    });
    expect(rows.find((r) => r.code === 'K162')).toMatchObject({
      destination: null,
      size: null,
      spawnsIn: [],
    });
  });

  it('sizes every type by its jump mass, as the map letters connections', () => {
    const size = (code: string) => rows.find((r) => r.code === code)?.size;
    expect(size('E004')).toBe('small'); // 5 000 t: C1 frigate hole
    expect(size('H121')).toBe('medium'); // 62 000 t
    expect(size('U210')).toBe('large'); // 375 000 t
    expect(size('C729')).toBe('large'); // 410 000 t
    expect(size('B041')).toBe('xlarge'); // 1 000 000 t
    expect(size('C248')).toBe('capital'); // 2 000 000 t
  });

  it('puts spawn classes in class order', () => {
    expect(rows.find((r) => r.code === 'B735')?.spawnsIn).toEqual(['hs', 'ls', 'ns', 'jove']);
    expect(rows.find((r) => r.code === 'U210')?.spawnsIn).toEqual(['c3', 'c4-shattered', 'c5-shattered']);
  });
});

describe('filtering the reference', () => {
  it('finds a type by its code, in any case, and only that one', () => {
    expect(codes(filterRows(rows, { ...DEFAULT_FILTER, query: 'C247' }))).toEqual(['C247']);
    expect(codes(filterRows(rows, { ...DEFAULT_FILTER, query: ' u210 ' }))).toEqual(['U210']);
    expect(codes(filterRows(rows, { ...DEFAULT_FILTER, query: 'K162' }))).toEqual(['K162']);
  });

  it('matches classes, destinations and respawn; every word must match', () => {
    const thera = filterRows(rows, { ...DEFAULT_FILTER, query: 'thera' });
    expect(codes(thera)).toEqual(expect.arrayContaining(['F135', 'L031', 'E587', 'Q063']));
    const c5Statics = filterRows(rows, { ...DEFAULT_FILTER, query: 'c5 static' });
    expect(c5Statics.length).toBeGreaterThan(0);
    for (const row of c5Statics) {
      expect(row.respawn).toContain('static');
      expect([row.destination, ...row.spawnsIn].join(' ')).toMatch(/c5/);
    }
  });

  it('keeps the types that lead to one class', () => {
    const c5 = filterRows(rows, { ...DEFAULT_FILTER, destination: 'c5' });
    expect(codes(c5)).toEqual(['C008', 'H296', 'H900', 'L614', 'M555', 'N062', 'N432', 'N770', 'V911']);
  });

  it('keeps only statics when asked', () => {
    const statics = filterRows(rows, { ...DEFAULT_FILTER, staticsOnly: true });
    expect(statics.length).toBeGreaterThan(30);
    expect(statics.every((r) => r.respawn.includes('static'))).toBe(true);
    expect(codes(statics)).not.toContain('K162');
  });
});

describe('sorting the reference', () => {
  it('sorts by any column, missing values last either way', () => {
    const heaviest = sortRows(rows, { key: 'maxJumpMass', dir: 'desc' });
    expect(heaviest[0]!.maxJumpMass).toBe(2_000_000_000);
    expect(heaviest.at(-1)!.code).toBe('K162');
    const lightest = sortRows(rows, { key: 'maxJumpMass', dir: 'asc' });
    expect(lightest[0]!.maxJumpMass).toBe(5_000_000);
    expect(lightest.at(-1)!.code).toBe('K162');
    const bySize = sortRows(rows, { key: 'size', dir: 'asc' });
    expect(bySize[0]!.size).toBe('small');
    expect(bySize.filter((r) => r.size).at(-1)!.size).toBe('capital');
    const byClass = sortRows(rows, { key: 'destination', dir: 'asc' });
    expect(byClass[0]!.destination).toBe('c1');
    const byRespawn = sortRows(rows, { key: 'respawn', dir: 'asc' });
    expect(byRespawn[0]!.respawn[0]).toBe('static');
  });

  it('turns a column around on a second click; numbers start biggest first', () => {
    expect(firstSort('totalMass')).toEqual({ key: 'totalMass', dir: 'desc' });
    expect(firstSort('code')).toEqual({ key: 'code', dir: 'asc' });
    expect(nextSort({ key: 'code', dir: 'asc' }, 'code')).toEqual({ key: 'code', dir: 'desc' });
    expect(nextSort({ key: 'code', dir: 'asc' }, 'lifetime')).toEqual({ key: 'lifetime', dir: 'desc' });
  });
});

describe('the size legend', () => {
  it('says which hulls each size lets through, from the catalog', () => {
    expect(
      sizeLegend(catalog.types).map(({ size, maxJumpMass, adds }) => ({ size, maxJumpMass, adds })),
    ).toEqual([
      { size: 'small', maxJumpMass: 5_000_000, adds: ['frigate', 'destroyer'] },
      { size: 'medium', maxJumpMass: 62_000_000, adds: ['cruiser', 'battlecruiser', 'industrial'] },
      { size: 'large', maxJumpMass: 410_000_000, adds: ['battleship', 'industrialCommand'] },
      { size: 'xlarge', maxJumpMass: 1_000_000_000, adds: ['freighter'] },
      { size: 'capital', maxJumpMass: 2_000_000_000, adds: ['capital'] },
    ]);
  });

  it('names sizes as the game does, with the hulls only in the hint', () => {
    const h296 = rows.find((r) => r.code === 'H296')!;
    expect(sizeHint(h296.size!, h296.maxJumpMass, h296.fits)).toEqual({
      name: 'Extra large (capital-mass)',
      mass: '≤ 2 000 000 t per jump',
      fits: 'Frigates, Destroyers, Cruisers, Battlecruisers, Industrials, Battleships, Orca / Porpoise, Freighters, Capitals',
    });
    const e004 = rows.find((r) => r.code === 'E004')!;
    expect(sizeHint(e004.size!, e004.maxJumpMass, e004.fits)).toEqual({
      name: 'Small',
      mass: '≤ 5 000 t per jump',
      fits: 'Frigates, Destroyers',
    });
    // The game's size word finds a type too.
    const extraLarge = filterRows(rows, { ...DEFAULT_FILTER, query: 'extra large' });
    expect(extraLarge.length).toBeGreaterThan(0);
    expect(extraLarge.every((r) => r.size === 'xlarge' || r.size === 'capital')).toBe(true);
  });

  it('writes masses as whole tonnes', () => {
    expect(tonnes(2_000_000_000)).toBe('2 000 000 t');
    expect(tonnes(375_000_000)).toBe('375 000 t');
    expect(tonnes(null)).toBe('—');
  });

  it('writes lifetimes as hours', () => {
    expect(lifetimeText(16)).toBe('16 h');
    expect(lifetimeText(4.5)).toBe('4.5 h');
    expect(lifetimeText(null)).toBe('—');
  });
});
