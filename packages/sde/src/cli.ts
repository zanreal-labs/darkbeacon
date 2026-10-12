import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildUniverse, formatUniverse, parseJsonl, SDE_FILES, type SdeInput } from './build.js';
import { KSPACE_DATA_FILE, STATION_DATA_FILE, UNIVERSE_DATA_FILE, WORMHOLE_DATA_FILE } from './index.js';
import {
  buildKspace,
  formatKspace,
  KSPACE_SDE_FILES,
  type RawStation,
  type RawSystemPosition,
} from './kspace.js';
import {
  BLUE_LOOT_TYPES,
  buildStations,
  formatStations,
  npcBuyStations,
  planetNames,
  RED_LOOT_TYPES,
  STATION_SDE_FILES,
  type RawPlanet,
} from './stations.js';
import {
  buildWormholes,
  formatWormholes,
  MASS_MODULE_GROUPS,
  parseStaticsCsv,
  SUBSYSTEM_CATEGORY_ID,
  SHIP_CATEGORY_ID,
  WORMHOLE_GROUP_ID,
  WORMHOLE_SDE_FILES,
  type RawGroup,
  type RawSecondarySun,
  type RawType,
  type RawTypeDogma,
  type WormholeInput,
} from './wormholes.js';
import { readZipEntries } from './zip.js';

// Builds data/universe.json, data/wormholes.json and data/kspace.json:
//   pnpm --filter @darkbeacon/sde data [--from <url|zip>] [--statics <url|csv>] [--out <dir files>]

const LATEST = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';

/**
 * Statics table of WormholeSystems (https://github.com/WormholeSystems/WormholeSystems, MIT,
 * Copyright (c) 2025 WormholeSystems), pinned to a commit so a rebuild is reproducible. Move the
 * pin to take their updates; see `data/wormholes.LICENSE`.
 */
export const STATICS_COMMIT = '48c89bf0d11260567146e5b334ba2c27f4205754';
const STATICS = `https://raw.githubusercontent.com/WormholeSystems/WormholeSystems/${STATICS_COMMIT}/database/seeders/data/wormhole_systems.csv`;

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: LATEST },
    statics: { type: 'string', default: STATICS },
    out: { type: 'string', default: UNIVERSE_DATA_FILE },
    'wormholes-out': { type: 'string', default: WORMHOLE_DATA_FILE },
    'kspace-out': { type: 'string', default: KSPACE_DATA_FILE },
    'stations-out': { type: 'string', default: STATION_DATA_FILE },
  },
});

async function fetchBytes(source: string): Promise<Buffer> {
  if (!/^https?:\/\//.test(source)) return readFile(source);
  console.log(`downloading ${source}`);
  const response = await fetch(source, { headers: { 'user-agent': 'Darkbeacon SDE builder' } });
  if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

const entries = readZipEntries(await fetchBytes(values.from), [
  ...Object.values(SDE_FILES),
  ...Object.values(WORMHOLE_SDE_FILES),
  ...Object.values(KSPACE_SDE_FILES),
  ...Object.values(STATION_SDE_FILES),
]);
const text = (name: string) => {
  const entry = entries.get(name);
  if (!entry) throw new Error(`${name} is missing from the SDE`);
  return entry.toString('utf8');
};
const read = <T>(name: string) => parseJsonl<T>(text(name));

const meta = read<SdeInput['meta']>(SDE_FILES.meta)[0]!;
const rawSystems = read<SdeInput['systems'][number] & RawSystemPosition>(SDE_FILES.systems);
const universe = buildUniverse({
  meta,
  regions: read(SDE_FILES.regions),
  constellations: read(SDE_FILES.constellations),
  systems: rawSystems,
  stargates: read(SDE_FILES.stargates),
});
await writeFile(values.out, formatUniverse(universe));
console.log(
  `${universe.source}: ${universe.systems.length} systems in ${universe.regions.length} regions -> ${values.out}`,
);

// types.jsonl is large: keep only wormholes, ships, the modules that change a ship's mass and the
// effect beacons of wormhole systems.
const groups = read<RawGroup>(WORMHOLE_SDE_FILES.groups);
const secondarySuns = read<RawSecondarySun>(WORMHOLE_SDE_FILES.secondarySuns);
const beacons = new Set(secondarySuns.map((s) => s.effectBeaconTypeID));
const shipGroups = new Set(groups.filter((g) => g.categoryID === SHIP_CATEGORY_ID).map((g) => g._key));
const moduleGroups = new Set<number>(Object.values(MASS_MODULE_GROUPS));
// Armour plates and subsystems change a fitted ship's mass too (pasted fits).
for (const g of groups) {
  if (g.categoryID === SUBSYSTEM_CATEGORY_ID || g.name.en === 'Armor Plate') moduleGroups.add(g._key);
}
const wanted = (groupId: number) =>
  groupId === WORMHOLE_GROUP_ID || shipGroups.has(groupId) || moduleGroups.has(groupId);
const types = text(WORMHOLE_SDE_FILES.types)
  .split('\n')
  .filter((line) => {
    const group = /"groupID":\s*(\d+)/.exec(line);
    const key = /^\{"_key":\s*(\d+)/.exec(line);
    return (group !== null && wanted(Number(group[1]))) || (key !== null && beacons.has(Number(key[1])));
  })
  .map((line) => JSON.parse(line) as RawType);
const shipIds = new Set(types.filter((t) => shipGroups.has(t.groupID)).map((t) => t._key));
const withDogma = new Set(types.filter((t) => wanted(t.groupID)).map((t) => t._key));
// Wormholes, ships and the modules that change mass: wormholes.json takes them all, kspace.json the ships.
const typeDogma = read<RawTypeDogma>(WORMHOLE_SDE_FILES.typeDogma).filter((d) => withDogma.has(d._key));
const input: WormholeInput = {
  meta,
  groups,
  types,
  typeDogma,
  secondarySuns,
  statics: parseStaticsCsv((await fetchBytes(values.statics)).toString('utf8')),
  staticsSource: `WormholeSystems ${STATICS_COMMIT.slice(0, 7)} (MIT)`,
};
const wormholes = buildWormholes(input);
const missing = universe.systems.filter(
  (s) => s.id >= 31_000_000 && s.id < 32_000_000 && !wormholes.systems[s.id],
);
if (missing.length > 0)
  console.warn(`no wormhole facts for ${missing.length} systems: ${missing.map((s) => s.name).join(', ')}`);
await writeFile(values['wormholes-out'], formatWormholes(wormholes));
console.log(
  `${wormholes.types?.length} wormhole types, ${wormholes.ships?.length} ships, ${Object.keys(wormholes.systems).length} systems -> ${values['wormholes-out']}`,
);

const kspace = buildKspace({
  universe,
  positions: rawSystems,
  stations: read<RawStation>(KSPACE_SDE_FILES.stations),
  types: types.filter((t) => shipIds.has(t._key)),
  typeDogma: typeDogma.filter((d) => shipIds.has(d._key)),
});
await writeFile(values['kspace-out'], formatKspace(kspace));
console.log(
  `${kspace.systems.id.length} known-space systems, ${kspace.gates.length / 2} stargates, ${kspace.ships.length} jump-capable ships -> ${values['kspace-out']}`,
);

// Stations, and which of them buy blue and red loot (NPC buy orders on ESI's regional markets).
const fetchJson = async (url: string): Promise<unknown> => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': 'Darkbeacon SDE builder' } });
    if (response.ok) return response.json();
    if (response.status === 404) return null;
    if (attempt >= 3) throw new Error(`${url}: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
};
const knownRegions = universe.regions.filter((r) => r.id < 11_000_000).map((r) => r.id);
console.log(`reading NPC loot buy orders in ${knownRegions.length} regions`);
const stations = buildStations({
  meta,
  stations: read(STATION_SDE_FILES.stations),
  operations: read(STATION_SDE_FILES.operations),
  corporations: read(STATION_SDE_FILES.corporations),
  planetNames: planetNames(
    text(STATION_SDE_FILES.planets)
      .split('\n')
      .filter((line) => line.includes('"uniqueName"'))
      .map((line) => JSON.parse(line) as RawPlanet),
  ),
  systems: new Map(universe.systems.map((s) => [s.id, { name: s.name, security: s.security }])),
  blueLoot: await npcBuyStations(BLUE_LOOT_TYPES, knownRegions, fetchJson),
  redLoot: await npcBuyStations(RED_LOOT_TYPES, knownRegions, fetchJson),
  buyOrdersSource: `ESI markets ${new Date().toISOString().slice(0, 10)}`,
});
await writeFile(values['stations-out'], formatStations(stations));
console.log(`${stations.stations.length} stations -> ${values['stations-out']}`);
