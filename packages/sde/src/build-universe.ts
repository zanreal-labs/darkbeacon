/**
 * Builds `data/universe.json` from CCP's Static Data Export, JSONL edition.
 *
 *   pnpm --filter @wormwright/sde build:universe            # downloads the latest SDE (~100 MB)
 *   pnpm --filter @wormwright/sde build:universe sde.zip    # uses a zip you already have
 *
 * Reads mapRegions, mapConstellations, mapSolarSystems and mapStargates.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import type { UniverseData } from './index.js';

export const SDE_URL = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';

type Row = Record<string, unknown>;

/** Localized SDE names are `{ en: '...', de: '...' }`; older dumps used plain strings. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'en' in value) return String(value.en);
  return '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function parseJsonl(content: string): Row[] {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row);
}

/** Turns the four SDE tables into the `universe.json` format. */
export function buildUniverse(
  tables: { regions: Row[]; constellations: Row[]; systems: Row[]; stargates: Row[] },
  source: string,
): UniverseData {
  const regionClass = new Map(tables.regions.map((r) => [r._key, num(r.wormholeClassID)]));
  const constellationClass = new Map(tables.constellations.map((c) => [c._key, num(c.wormholeClassID)]));
  const gates = new Map<number, Set<number>>();
  for (const gate of tables.stargates) {
    const from = num(gate.solarSystemID);
    const to = num((gate.destination as Row | undefined)?.solarSystemID);
    if (from === null || to === null) continue;
    if (!gates.has(from)) gates.set(from, new Set());
    gates.get(from)!.add(to);
  }
  return {
    source,
    regions: tables.regions.map((r) => ({ id: Number(r._key), name: text(r.name) })),
    constellations: tables.constellations.map((c) => ({
      id: Number(c._key),
      name: text(c.name),
      regionId: Number(c.regionID),
    })),
    systems: tables.systems
      .map((s) => ({
        id: Number(s._key),
        name: text(s.name),
        regionId: Number(s.regionID),
        constellationId: Number(s.constellationID),
        security: Math.round((num(s.securityStatus) ?? 0) * 10_000) / 10_000,
        // A system inherits its wormhole class from its constellation, then its region.
        whClass:
          num(s.wormholeClassID) ??
          constellationClass.get(s.constellationID) ??
          regionClass.get(s.regionID) ??
          null,
        gates: [...(gates.get(Number(s._key)) ?? [])].sort((a, b) => a - b),
      }))
      .sort((a, b) => a.id - b.id),
  };
}

/** Minimal zip reader (stored and deflated entries, no zip64): file name -> contents. */
export function unzip(archive: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip archive');
  const count = archive.readUInt16LE(eocd + 10);
  let p = archive.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = archive.readUInt16LE(p + 10);
    const size = archive.readUInt32LE(p + 20);
    const nameLength = archive.readUInt16LE(p + 28);
    const local = archive.readUInt32LE(p + 42);
    const name = archive.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + archive.readUInt16LE(p + 30) + archive.readUInt16LE(p + 32);
    if (!wanted(name)) continue;
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`unsupported zip compression ${method} for ${name}`);
  }
  return files;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  let archive: Buffer;
  if (input) archive = readFileSync(input);
  else {
    console.log(`downloading ${SDE_URL}`);
    const response = await fetch(SDE_URL);
    if (!response.ok) throw new Error(`SDE download failed: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  const names = ['mapRegions', 'mapConstellations', 'mapSolarSystems', 'mapStargates', '_sde'];
  const files = unzip(archive, (name) => names.includes(basename(name, '.jsonl')));
  const find = (name: string) => [...files].find(([file]) => basename(file, '.jsonl') === name)?.[1];
  const table = (name: string) => {
    const content = find(name);
    if (!content) throw new Error(`${name}.jsonl missing from the SDE archive`);
    return parseJsonl(content.toString('utf8'));
  };
  const info = find('_sde');
  const build = info ? parseJsonl(info.toString('utf8'))[0]?.buildNumber : undefined;
  const universe = buildUniverse(
    {
      regions: table('mapRegions'),
      constellations: table('mapConstellations'),
      systems: table('mapSolarSystems'),
      stargates: table('mapStargates'),
    },
    build ? `sde-${String(build)}` : 'sde',
  );
  const out = fileURLToPath(new URL('../data/universe.json', import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(universe)}\n`);
  console.log(`wrote ${universe.systems.length} systems to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
