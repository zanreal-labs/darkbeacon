import { describe, expect, it } from 'vitest';
import { loadKspaceData, type UniverseData } from './index.js';
import { buildJumpShips, buildKspace, formatKspace, KSPACE_FLAGS, METERS_PER_LY } from './kspace.js';

const system = (id: number, regionId: number, security: number, gates: number[], whClass = 8) => ({
  id,
  name: `S${id}`,
  regionId,
  constellationId: 20000001,
  security,
  whClass,
  gates,
});

const universe: UniverseData = {
  source: 'SDE build 7 (2026-10-07)',
  regions: [
    { id: 10000001, name: 'One' },
    { id: 10000004, name: 'UUA-F4' },
    { id: 10000070, name: 'Pochven' },
  ],
  constellations: [],
  systems: [
    system(30000001, 10000001, 0.9, [30000002], 7),
    system(30000002, 10000001, 0.3, [30000001, 30100000]),
    system(30100000, 10000001, -1, [30000002], 9), // Zarzakh
    system(30000003, 10000004, -1, [30000004], 9), // Jove: only linked to itself
    system(30000004, 10000004, -1, [30000003], 9),
    system(30000005, 10000004, -1, [], 9), // Jove: no gate at all
    system(30000006, 10000070, -1, [], 25), // Pochven
    system(31000001, 10000001, -1, [], 3), // wormhole space
  ],
};

const at = (key: number, x: number, y = 0, z = 0) => ({
  _key: key,
  position: { x: x * METERS_PER_LY, y: y * METERS_PER_LY, z: z * METERS_PER_LY },
});

describe('buildKspace', () => {
  const data = buildKspace({
    universe,
    positions: [
      at(30000001, 1.23456789, 2, -3),
      at(30000002, 4),
      at(30100000, 5),
      at(30000003, 9),
      at(30000004, 9),
      at(30000005, 9),
      at(30000006, 7),
      at(31000001, 0),
    ],
    stations: [{ solarSystemID: 30000001 }],
    types: [],
    typeDogma: [],
  });

  it('keeps known space the stargates reach, and Pochven', () => {
    expect(data.systems.id).toEqual([30000001, 30000002, 30100000, 30000006]);
    expect(data.regions.map((r) => r.name)).toEqual(['One', 'Pochven']);
    expect(data.systems.region).toEqual([0, 0, 0, 1]);
  });

  it('stores light years, flags and stargates as index pairs', () => {
    expect(data.systems.x[0]).toBe(1.2346);
    expect(data.systems.y[0]).toBe(2);
    expect(data.systems.z[0]).toBe(-3);
    expect(data.systems.flags).toEqual([KSPACE_FLAGS.station, 0, KSPACE_FLAGS.zarzakh, KSPACE_FLAGS.pochven]);
    expect(data.gates).toEqual([0, 1, 1, 2]);
    expect(JSON.parse(formatKspace(data))).toEqual(data);
  });
});

describe('buildJumpShips', () => {
  it('takes published ships with a jump drive and their SDE attributes', () => {
    const ships = buildJumpShips(
      [
        { _key: 28850, groupID: 902, name: { en: 'Ark' }, mass: 900_000_000, published: true },
        { _key: 20185, groupID: 513, name: { en: 'Charon' }, mass: 960_000_000, published: true },
        { _key: 99999, groupID: 902, name: { en: 'Unreleased' }, mass: 1, published: false },
      ],
      [
        {
          _key: 28850,
          dogmaAttributes: [
            { attributeID: 861, value: 1 },
            { attributeID: 866, value: 16274 },
            { attributeID: 867, value: 5 },
            { attributeID: 868, value: 8800 },
            { attributeID: 1971, value: 0.1 },
          ],
        },
        { _key: 20185, dogmaAttributes: [] },
        { _key: 99999, dogmaAttributes: [{ attributeID: 861, value: 1 }] },
      ],
    );
    expect(ships).toEqual([
      {
        typeId: 28850,
        name: 'Ark',
        group: 902,
        rangeLy: 5,
        fuelPerLy: 8800,
        isotope: 'helium',
        fatigueMultiplier: 0.1,
        mass: 900_000_000,
        portalMassFactor: null,
      },
    ]);
  });
});

describe('the committed k-space dataset', () => {
  it('has all of reachable known space, the stargates and the jump-capable ships', () => {
    const data = loadKspaceData();
    expect(data.systems.id.length).toBeGreaterThan(5200);
    expect(data.systems.id).toContain(30000142); // Jita
    expect(data.systems.id.every((id) => id < 31_000_000)).toBe(true);
    expect(data.gates.length).toBeGreaterThan(13_000);
    const ark = data.ships.find((s) => s.name === 'Ark');
    expect(ark).toMatchObject({ rangeLy: 5, fuelPerLy: 8800, isotope: 'helium', fatigueMultiplier: 0.1 });
    const jita = data.systems.id.indexOf(30000142);
    // Jita at x -13.64, z 12.42 ly (SDE position / 9.4607e15 m).
    expect(data.systems.x[jita]).toBeCloseTo(-13.64, 2);
    expect(data.systems.z[jita]).toBeCloseTo(12.42, 2);
  });
});
