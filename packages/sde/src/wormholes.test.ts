import { describe, expect, it } from 'vitest';
import { loadUniverseData, loadWormholeData } from './index.js';
import {
  buildWormholes,
  formatWormholes,
  parseCsv,
  parseStaticsCsv,
  WORMHOLE_ATTRIBUTES as A,
  type WormholeInput,
} from './wormholes.js';

const input: WormholeInput = {
  meta: { buildNumber: 7, releaseDate: '2026-10-07T11:10:05Z' },
  groups: [
    { _key: 988, categoryID: 2, name: { en: 'Wormhole' } },
    { _key: 25, categoryID: 6, name: { en: 'Frigate' } },
    { _key: 420, categoryID: 6, name: { en: 'Destroyer' } },
    ...[26, 419, 28, 27, 941, 513, 485].map((g) => ({ _key: g, categoryID: 6, name: { en: `G${g}` } })),
  ],
  types: [
    { _key: 30695, groupID: 988, name: { en: 'Wormhole D845' } },
    { _key: 30831, groupID: 988, name: { en: 'Wormhole K162' } },
    { _key: 32894, groupID: 988, name: { en: 'QA Wormhole A' } },
    { _key: 30667, groupID: 988, name: { en: 'Wormhole J244' } },
    { _key: 73748, groupID: 988, name: { en: 'Wormhole J244' } },
    { _key: 587, groupID: 25, name: { en: 'Rifter' }, mass: 1_067_000, published: true },
    { _key: 16236, groupID: 420, name: { en: 'Coercer' }, mass: 1_650_000, published: true },
    { _key: 99999, groupID: 25, name: { en: 'Unreleased' }, mass: 9_000_000, published: false },
    ...[26, 419, 28, 27, 941, 513, 485].map((g) => ({
      _key: 100 + g,
      groupID: g,
      name: { en: `Ship ${g}` },
      mass: g * 1_000_000,
      published: true,
    })),
    { _key: 30575, groupID: 995, name: { en: 'Black Hole' } },
    { _key: 30845, groupID: 920, name: { en: 'Class 1 Black Hole Effects' } },
    { _key: 30849, groupID: 920, name: { en: 'Class 1 Wolf Rayet Effects' } },
  ],
  typeDogma: [
    {
      _key: 30695,
      dogmaAttributes: [
        { attributeID: A.targetSystemClass, value: 7 },
        { attributeID: A.maxStableTime, value: 1440 },
        { attributeID: A.maxStableMass, value: 5_000_000_000 },
        { attributeID: A.massRegeneration, value: 0 },
        { attributeID: A.maxJumpMass, value: 375_000_000 },
        { attributeID: A.targetDistribution, value: 302 },
      ],
    },
    { _key: 30667, dogmaAttributes: [{ attributeID: A.targetSystemClass, value: 8 }] },
  ],
  secondarySuns: [
    { solarSystemID: 31000001, typeID: 30575, effectBeaconTypeID: 30845 },
    // The beacon decides, not the look of the sun.
    { solarSystemID: 31000002, typeID: 30575, effectBeaconTypeID: 30849 },
  ],
  statics: [
    { solarSystemId: 31000001, statics: ['D845'] },
    { solarSystemId: 31000003, statics: [] },
  ],
  staticsSource: 'test table',
};

describe('buildWormholes', () => {
  const data = buildWormholes(input);

  it('reads wormhole types and their attributes from the SDE', () => {
    expect(data.source).toBe('SDE build 7 (2026-10-07); statics: test table');
    expect(data.types?.map((t) => t.code)).toEqual(['D845', 'J244', 'K162']);
    expect(data.types?.[0]).toEqual({
      code: 'D845',
      typeId: 30695,
      targetClass: 7,
      maxStableTimeMinutes: 1440,
      maxStableMass: 5_000_000_000,
      maxJumpMass: 375_000_000,
      massRegeneration: 0,
      targetDistribution: 302,
    });
    // The first variant of a code wins; K162 has no attributes.
    expect(data.types?.[1]).toMatchObject({ typeId: 30667, targetClass: 8, maxJumpMass: null });
    expect(data.types?.[2]).toMatchObject({ typeId: 30831, targetClass: null });
  });

  it('measures hull classes by their heaviest published ship and keeps every ship mass', () => {
    expect(data.hullClasses?.find((h) => h.id === 'frigate')).toEqual({
      id: 'frigate',
      minMass: 1_067_000,
      maxMass: 1_067_000,
    });
    expect(data.hullClasses?.find((h) => h.id === 'destroyer')?.maxMass).toBe(1_650_000);
    expect(data.shipMasses).toMatchObject({ 587: 1_067_000, 99999: 9_000_000 });
  });

  it('takes statics from the table and effects from the effect beacons', () => {
    expect(data.systems).toEqual({
      31000001: { statics: ['D845'], effect: 'blackHole' },
      31000002: { statics: [], effect: 'wolfRayet' },
      31000003: { statics: [], effect: null },
    });
  });

  it('formats one entry per line and reads back the same', () => {
    const text = formatWormholes(data);
    expect(text.split('\n').filter((l) => l.startsWith('    {"code"'))).toHaveLength(3);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(data)));
  });
});

describe('statics table', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '2'],
    ]);
  });

  it('keeps wormhole space and valid codes only', () => {
    const csv = [
      'name,id,class,effect,statics',
      'J055520,31000001,14,Red Giant,"Z647, d382, junk"',
      'Thera,31000005,12,,"Q063, V898, E587"',
      'AD001,34000001,19,,',
      'Jita,30000142,7,,',
    ].join('\n');
    expect(parseStaticsCsv(csv)).toEqual([
      { solarSystemId: 31000001, statics: ['Z647', 'D382'] },
      { solarSystemId: 31000005, statics: ['Q063', 'V898', 'E587'] },
    ]);
  });
});

describe('committed wormhole dataset', () => {
  const universe = loadUniverseData();
  const wormholes = loadWormholeData();
  const types = new Map((wormholes.types ?? []).map((t) => [t.code, t]));

  it('has statics or an entry for every wormhole system, C13, Thera and Drifter systems included', () => {
    const jSpace = universe.systems.filter((s) => s.id >= 31_000_000 && s.id < 32_000_000);
    expect(jSpace.length).toBeGreaterThan(2500);
    for (const system of jSpace) expect(wormholes.systems[system.id], system.name).toBeDefined();
    const byClass = (whClass: number) => jSpace.filter((s) => s.whClass === whClass);
    expect(byClass(12).map((s) => wormholes.systems[s.id]?.statics)).toEqual([['Q063', 'V898', 'E587']]);
    expect(byClass(13).length).toBeGreaterThan(0);
    for (const c of [14, 15, 16, 17, 18])
      expect(byClass(c).every((s) => wormholes.systems[s.id]!.statics!.length > 0)).toBe(true);
    // Ordinary classes always have at least one static.
    for (const c of [1, 2, 3, 4, 5, 6])
      expect(
        byClass(c)
          .filter((s) => wormholes.systems[s.id]!.statics!.length === 0)
          .map((s) => s.name),
      ).toEqual([]);
  });

  it('only names wormhole types the SDE knows', () => {
    for (const [id, entry] of Object.entries(wormholes.systems)) {
      for (const code of entry.statics ?? []) expect(types.has(code), `${id} ${code}`).toBe(true);
    }
  });

  it('agrees with the systems checked by hand', () => {
    expect(wormholes.systems[31002531]).toEqual({ statics: ['D845', 'U210'], effect: 'redGiant' });
    expect(wormholes.systems[31000399]).toEqual({ statics: ['B274', 'O477'], effect: 'magnetar' });
    expect(wormholes.systems[31001924]).toEqual({ statics: ['D364'], effect: 'pulsar' });
    expect(wormholes.systems[31000220]).toEqual({ statics: ['N110'], effect: 'blackHole' });
  });

  it('knows the D845 numbers', () => {
    expect(types.get('D845')).toMatchObject({
      targetClass: 7,
      maxStableTimeMinutes: 1440,
      maxStableMass: 5_000_000_000,
      maxJumpMass: 375_000_000,
    });
  });
});
