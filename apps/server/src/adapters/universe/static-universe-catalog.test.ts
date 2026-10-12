import { describe, expect, it } from 'vitest';
import { WORMHOLE_TYPES, type WormholeDestination } from '@darkbeacon/shared';
import { StaticUniverseCatalog } from './static-universe-catalog.js';

const small = new StaticUniverseCatalog(
  {
    source: 'test',
    regions: [{ id: 1, name: 'The Forge' }],
    constellations: [{ id: 2, name: 'Kimotoro', regionId: 1 }],
    systems: [
      { id: 10, name: 'Jita', regionId: 1, constellationId: 2, security: 0.9459, whClass: 7, gates: [11] },
      { id: 11, name: 'Perimeter', regionId: 1, constellationId: 2, security: 0.95, whClass: 7, gates: [10] },
      { id: 12, name: 'Ajita', regionId: 1, constellationId: 2, security: 0.5, whClass: 7, gates: [] },
      { id: 13, name: 'Jitanen', regionId: 1, constellationId: 2, security: 0.5, whClass: 7, gates: [] },
      { id: 14, name: 'J100001', regionId: 1, constellationId: 2, security: -0.99, whClass: 3, gates: [] },
    ],
  },
  {
    source: 'test',
    systems: { '14': { statics: ['d845', ' U210 '], effect: 'redGiant' }, '13': { effect: 'nonsense' } },
  },
);

describe('StaticUniverseCatalog', () => {
  it('returns systems with region and constellation names', () => {
    expect(small.getSystem(10)).toEqual({
      id: 10,
      name: 'Jita',
      regionName: 'The Forge',
      constellationName: 'Kimotoro',
      security: 0.9459,
      whClass: 7,
      statics: [],
      effect: null,
    });
    expect(small.getSystem(99)).toBeNull();
  });

  it('adds statics and the effect from the wormhole dataset', () => {
    expect(small.getSystem(14)).toMatchObject({ statics: ['D845', 'U210'], effect: 'redGiant' });
    expect(small.getSystem(13)).toMatchObject({ statics: [], effect: null });
  });

  it('searches case-insensitively, prefix matches first, up to the limit', () => {
    expect(small.searchSystems('JITA', 10).map((s) => s.name)).toEqual(['Jita', 'Jitanen', 'Ajita']);
    expect(small.searchSystems(' jita ', 2).map((s) => s.name)).toEqual(['Jita', 'Jitanen']);
    expect(small.searchSystems('meter', 10).map((s) => s.name)).toEqual(['Perimeter']);
    expect(small.searchSystems('', 10)).toEqual([]);
  });

  it('knows stargate links', () => {
    expect(small.gateLinked(10, 11)).toBe(true);
    expect(small.gateLinked(11, 10)).toBe(true);
    expect(small.gateLinked(10, 12)).toBe(false);
    expect(small.gateLinked(99, 10)).toBe(false);
  });

  it('loads the committed SDE dataset once', () => {
    const catalog = StaticUniverseCatalog.load('/nonexistent');
    expect(StaticUniverseCatalog.load('/nonexistent')).toBe(catalog);
    expect(catalog.searchSystems('thera', 5)[0]).toMatchObject({ id: 31000005, whClass: 12 });
    expect(catalog.getSystem(30000142)).toMatchObject({ name: 'Jita', regionName: 'The Forge' });
    expect(catalog.gateLinked(30000142, 30000144)).toBe(true);
    expect(catalog.getSystem(31002531)).toMatchObject({ name: 'J014348', statics: ['D845', 'U210'] });
  });

  it('serves every wormhole type with its SDE attributes and the hulls that fit', () => {
    const catalog = StaticUniverseCatalog.load('/nonexistent');
    expect(catalog.wormholeType(' d845 ')).toEqual({
      code: 'D845',
      destination: 'hs',
      targetClass: 7,
      lifetimeHours: 24,
      totalMass: 5_000_000_000,
      maxJumpMass: 375_000_000,
      massRegeneration: 0,
      fits: [
        'frigate',
        'destroyer',
        'battlecruiser',
        'cruiser',
        'industrial',
        'battleship',
        'industrialCommand',
      ],
      shipSize: 'large',
    });
    expect(catalog.wormholeType('E004')).toMatchObject({
      destination: 'c1',
      lifetimeHours: 4.5,
      maxJumpMass: 5_000_000,
      fits: ['frigate', 'destroyer'],
      shipSize: 'small',
    });
    expect(catalog.wormholeType('C248')).toMatchObject({ shipSize: 'capital' });
    expect(catalog.wormholeType('C248')?.fits).toContain('capital');
    expect(catalog.wormholeType('B274')?.fits).not.toContain('freighter');
    expect(catalog.wormholeType('K162')).toMatchObject({ destination: null, totalMass: null, fits: [] });
    // Region-bound types lead where the shared table says.
    expect(catalog.wormholeType('C729')).toMatchObject({ targetClass: -1, destination: 'pochven' });
    expect(catalog.wormholeType('XXXX')).toBeNull();
    expect(catalog.hullClasses().map((h) => h.id)).toContain('capital');
    expect(catalog.shipMass(587)).toBe(1_067_000); // Rifter
    expect(catalog.shipMass(1)).toBeNull();
  });

  it('agrees with the shared wormhole table on every destination', () => {
    const catalog = StaticUniverseCatalog.load('/nonexistent');
    const classes: Record<WormholeDestination, number[]> = {
      c1: [1],
      c2: [2],
      c3: [3],
      c4: [4],
      c5: [5],
      c6: [6],
      hs: [7],
      ls: [8],
      ns: [9],
      thera: [12],
      c13: [13],
      drifter: [14, 15, 16, 17, 18],
      pochven: [25],
    };
    for (const type of catalog.wormholeTypes()) {
      if (type.code === 'K162' || type.targetClass === -1) continue;
      const listed = WORMHOLE_TYPES[type.code];
      expect(listed, type.code).toBeDefined();
      expect(classes[listed!], type.code).toContain(type.targetClass);
    }
  });

  it('marks the shattered systems the SDE overlays', () => {
    const real = StaticUniverseCatalog.load('/nonexistent');
    expect(real.getSystem(31002531)?.shattered).toBe(true); // J014348, a shattered C3
    expect(real.getSystem(30002086)?.shattered).toBe(true); // Turnur
    expect(real.getSystem(31000005)?.shattered).toBeUndefined(); // Thera
    expect(real.getSystem(30000142)?.shattered).toBeUndefined();
  });
});
