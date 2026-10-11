import { describe, expect, it } from 'vitest';
import { StaticUniverseCatalog } from './static-universe-catalog.js';

const small = new StaticUniverseCatalog({
  source: 'test',
  regions: [{ id: 1, name: 'The Forge' }],
  constellations: [{ id: 2, name: 'Kimotoro', regionId: 1 }],
  systems: [
    { id: 10, name: 'Jita', regionId: 1, constellationId: 2, security: 0.9459, whClass: 7, gates: [11] },
    { id: 11, name: 'Perimeter', regionId: 1, constellationId: 2, security: 0.95, whClass: 7, gates: [10] },
    { id: 12, name: 'Ajita', regionId: 1, constellationId: 2, security: 0.5, whClass: 7, gates: [] },
    { id: 13, name: 'Jitanen', regionId: 1, constellationId: 2, security: 0.5, whClass: 7, gates: [] },
  ],
});

describe('StaticUniverseCatalog', () => {
  it('returns systems with region and constellation names', () => {
    expect(small.getSystem(10)).toEqual({
      id: 10,
      name: 'Jita',
      regionName: 'The Forge',
      constellationName: 'Kimotoro',
      security: 0.9459,
      whClass: 7,
    });
    expect(small.getSystem(99)).toBeNull();
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
  });
});
