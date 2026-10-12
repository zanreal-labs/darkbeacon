import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildSystemFlags } from './flags.js';
import { buildUniverse, classFromSecurity, formatUniverse, parseJsonl, type SdeInput } from './build.js';
import { loadUniverseData } from './index.js';
import { readZipEntries } from './zip.js';

const input: SdeInput = {
  meta: { buildNumber: 42, releaseDate: '2026-10-07T11:10:05Z' },
  regions: [
    { _key: 10000002, name: { en: 'The Forge' } },
    { _key: 11000001, name: { en: 'A-R00001' }, wormholeClassID: 1 },
    { _key: 12000001, name: { en: 'ADR01' } },
  ],
  constellations: [
    { _key: 20000020, name: { en: 'Kimotoro' }, regionID: 10000002, wormholeClassID: 7 },
    { _key: 21000001, name: { en: 'A-C00001' }, regionID: 11000001 },
    { _key: 22000001, name: { en: 'ADC01' }, regionID: 12000001 },
  ],
  systems: [
    {
      _key: 30000144,
      name: { en: 'Perimeter' },
      regionID: 10000002,
      constellationID: 20000020,
      securityStatus: 0.95,
    },
    {
      _key: 30000142,
      name: { en: 'Jita' },
      regionID: 10000002,
      constellationID: 20000020,
      securityStatus: 0.9459,
    },
    {
      _key: 31000001,
      name: { en: 'J100001' },
      regionID: 11000001,
      constellationID: 21000001,
      securityStatus: -0.99,
      wormholeClassID: 3,
    },
    {
      _key: 32000001,
      name: { en: 'Abyss' },
      regionID: 12000001,
      constellationID: 22000001,
      securityStatus: -1,
    },
  ],
  stargates: [
    { solarSystemID: 30000142, destination: { solarSystemID: 30000144 } },
    { solarSystemID: 30000144, destination: { solarSystemID: 30000142 } },
    { solarSystemID: 30000142, destination: { solarSystemID: 32000001 } },
  ],
};

describe('buildUniverse', () => {
  it('keeps known and wormhole space, inherits wormhole classes and indexes gates', () => {
    const data = buildUniverse(input);
    expect(data.source).toBe('SDE build 42 (2026-10-07)');
    expect(data.systems).toEqual([
      {
        id: 30000142,
        name: 'Jita',
        regionId: 10000002,
        constellationId: 20000020,
        security: 0.9459,
        whClass: 7,
        gates: [30000144],
      },
      {
        id: 30000144,
        name: 'Perimeter',
        regionId: 10000002,
        constellationId: 20000020,
        security: 0.95,
        whClass: 7,
        gates: [30000142],
      },
      {
        id: 31000001,
        name: 'J100001',
        regionId: 11000001,
        constellationId: 21000001,
        security: -0.99,
        whClass: 3,
        gates: [],
      },
    ]);
    expect(data.regions.map((r) => r.name)).toEqual(['The Forge', 'A-R00001']);
    expect(data.constellations).toEqual([
      { id: 20000020, name: 'Kimotoro', regionId: 10000002 },
      { id: 21000001, name: 'A-C00001', regionId: 11000001 },
    ]);
  });

  it('round-trips through the committed file format', () => {
    const data = buildUniverse(input);
    expect(JSON.parse(formatUniverse(data))).toEqual(data);
  });

  it('derives a class from security when the SDE has none', () => {
    expect(classFromSecurity(1)).toBe(7);
    expect(classFromSecurity(0.45)).toBe(7);
    expect(classFromSecurity(0.44)).toBe(8);
    expect(classFromSecurity(0.01)).toBe(8);
    expect(classFromSecurity(0)).toBe(9);
    expect(classFromSecurity(-1)).toBe(9);
  });

  it('parses JSON Lines and skips blank lines', () => {
    expect(parseJsonl('{"a":1}\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe('readZipEntries', () => {
  it('reads stored and deflated entries', () => {
    const zip = makeZip([
      { name: 'a.jsonl', data: Buffer.from('{"a":1}\n'), deflate: false },
      { name: 'b.jsonl', data: Buffer.from('{"b":2}\n'.repeat(100)), deflate: true },
      { name: 'skip.txt', data: Buffer.from('ignored'), deflate: true },
    ]);
    const entries = readZipEntries(zip, ['a.jsonl', 'b.jsonl']);
    expect(entries.get('a.jsonl')?.toString()).toBe('{"a":1}\n');
    expect(entries.get('b.jsonl')?.toString()).toBe('{"b":2}\n'.repeat(100));
    expect(entries.has('skip.txt')).toBe(false);
  });

  it('reports missing entries and non-zip input', () => {
    const zip = makeZip([{ name: 'a.jsonl', data: Buffer.from('x'), deflate: false }]);
    expect(() => readZipEntries(zip, ['nope.jsonl'])).toThrow('missing in archive: nope.jsonl');
    expect(() => readZipEntries(Buffer.alloc(100), ['a'])).toThrow('not a zip archive');
  });
});

describe('committed dataset', () => {
  it('contains the universe with gate links both ways', () => {
    const data = loadUniverseData();
    const byName = new Map(data.systems.map((s) => [s.name, s]));
    expect(data.systems.length).toBeGreaterThan(8000);
    const jita = byName.get('Jita')!;
    expect(jita).toMatchObject({ id: 30000142, whClass: 7 });
    expect(jita.gates).toContain(byName.get('Perimeter')!.id);
    expect(byName.get('Perimeter')!.gates).toContain(jita.id);
    expect(byName.get('Thera')).toMatchObject({ whClass: 12, gates: [] });
    expect(data.regions.find((r) => r.id === jita.regionId)?.name).toBe('The Forge');
  });
});

/** Minimal zip writer for the reader test (no data descriptors, no zip64). */
function makeZip(files: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const body = file.deflate ? deflateRawSync(file.data) : file.data;
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('system flags', () => {
  it('keeps the systems the SDE draws with the shattered overlay', () => {
    expect(
      buildSystemFlags('SDE build 1', [
        { _key: 31002531, visualEffect: 'SHATTEREDWORMHOLE_OVERLAY' },
        { _key: 31000005, visualEffect: 'THERA' },
        { _key: 30002086, visualEffect: 'SHATTEREDWORMHOLE_OVERLAY' },
        { _key: 30000142 },
      ]),
    ).toEqual({ source: 'SDE build 1', shattered: [30002086, 31002531] });
  });
});
