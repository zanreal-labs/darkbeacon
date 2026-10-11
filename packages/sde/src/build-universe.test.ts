import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildUniverse, parseJsonl, unzip } from './build-universe.js';

/** Writes a zip with one deflated entry per file (no CRCs; the reader does not check them). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('universe build', () => {
  it('reads deflated zip entries', () => {
    const archive = zip({ 'a.jsonl': '{"x":1}', 'dir/b.jsonl': 'hello', 'c.txt': 'skip' });
    const files = unzip(archive, (name) => name.endsWith('.jsonl'));
    expect([...files.keys()]).toEqual(['a.jsonl', 'dir/b.jsonl']);
    expect(files.get('dir/b.jsonl')?.toString()).toBe('hello');
    expect(parseJsonl(files.get('a.jsonl')!.toString())).toEqual([{ x: 1 }]);
  });

  it('builds systems with inherited wormhole classes and gate neighbours', () => {
    const universe = buildUniverse(
      {
        regions: [
          { _key: 10, name: { en: 'Kspace' } },
          { _key: 11, name: { en: 'Wspace' }, wormholeClassID: 3 },
        ],
        constellations: [
          { _key: 20, name: { en: 'K1' }, regionID: 10 },
          { _key: 21, name: { en: 'W1' }, regionID: 11 },
        ],
        systems: [
          {
            _key: 2,
            name: { en: 'B' },
            regionID: 10,
            constellationID: 20,
            securityStatus: 0.45678,
            wormholeClassID: 8,
          },
          {
            _key: 1,
            name: { en: 'A' },
            regionID: 10,
            constellationID: 20,
            securityStatus: 0.9,
            wormholeClassID: 7,
          },
          { _key: 3, name: 'J1', regionID: 11, constellationID: 21, securityStatus: -1 },
        ],
        stargates: [
          { _key: 100, solarSystemID: 1, destination: { solarSystemID: 2, stargateID: 101 } },
          { _key: 101, solarSystemID: 2, destination: { solarSystemID: 1, stargateID: 100 } },
        ],
      },
      'test',
    );
    expect(universe.systems).toEqual([
      { id: 1, name: 'A', regionId: 10, constellationId: 20, security: 0.9, whClass: 7, gates: [2] },
      { id: 2, name: 'B', regionId: 10, constellationId: 20, security: 0.4568, whClass: 8, gates: [1] },
      { id: 3, name: 'J1', regionId: 11, constellationId: 21, security: -1, whClass: 3, gates: [] },
    ]);
    expect(universe.regions).toEqual([
      { id: 10, name: 'Kspace' },
      { id: 11, name: 'Wspace' },
    ]);
  });
});
