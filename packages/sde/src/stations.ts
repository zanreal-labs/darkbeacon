import type { StationData } from './index.js';

/** SDE files the station dataset is built from (besides the map files of the universe). */
export const STATION_SDE_FILES = {
  stations: 'npcStations.jsonl',
  operations: 'stationOperations.jsonl',
  corporations: 'npcCorporations.jsonl',
  planets: 'mapPlanets.jsonl',
} as const;

/** The SDE station service "Security Office" (`stationServices.jsonl`). */
export const SECURITY_OFFICE_SERVICE = 27;
/** NPC corporations whose low-sec stations run the security office that takes clone soldier tags. */
export const SECURITY_OFFICE_OWNERS = [1000125, 1000137]; // CONCORD, DED

/** Sleeper components ("blue loot"): Neural Network Analyzer, Sleeper Data Library, Ancient Coordinates Database, Sleeper Drone AI Nexus. */
export const BLUE_LOOT_TYPES = [30744, 30745, 30746, 30747];
/** Triglavian Survey Database ("red loot"). */
export const RED_LOOT_TYPES = [48121];

/** The station each trade hub is known for. */
export const TRADE_HUB_STATIONS = [
  60003760, // Jita IV - Moon 4 - Caldari Navy Assembly Plant
  60008494, // Amarr VIII (Oris) - Emperor Family Academy
  60011866, // Dodixie IX - Moon 20 - Federation Navy Assembly Plant
  60005686, // Hek VIII - Moon 12 - Boundless Creation Factory
  60004588, // Rens VI - Moon 8 - Brutor Tribe Treasury
];

type Localized = { en?: string };

export interface RawStation {
  _key: number;
  solarSystemID: number;
  ownerID: number;
  operationID: number;
  celestialIndex?: number;
  orbitIndex?: number;
  useOperationName?: boolean;
}

export interface RawOperation {
  _key: number;
  operationName: Localized;
  services: number[];
}

/** A planet with a name of its own (`uniqueName`); planets without one are skipped. */
export interface RawPlanet {
  solarSystemID: number;
  celestialIndex: number;
  uniqueName?: Localized;
}

/** Planet names by `<system id>:<planet index>`, from the planets that have one. */
export function planetNames(planets: Iterable<RawPlanet>): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of planets) {
    if (p.uniqueName?.en) names.set(`${p.solarSystemID}:${p.celestialIndex}`, p.uniqueName.en);
  }
  return names;
}

export interface RawCorporation {
  _key: number;
  name: Localized;
}

export interface StationInput {
  meta: { buildNumber: number; releaseDate?: string };
  stations: RawStation[];
  operations: RawOperation[];
  corporations: RawCorporation[];
  /** `<system id>:<planet index>` -> the planet's own name ("Amarr VIII (Oris)"), where it has one. */
  planetNames: ReadonlyMap<string, string>;
  /** System id -> name and true security, from the map files. */
  systems: ReadonlyMap<number, { name: string; security: number }>;
  /** Stations with NPC buy orders for blue and red loot (from ESI's market, see `npcBuyStations`). */
  blueLoot: readonly number[];
  redLoot: readonly number[];
  buyOrdersSource: string;
}

const ROMAN: ReadonlyArray<[number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  let rest = n;
  let out = '';
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

/**
 * A station's name as the game shows it: the planet (and moon) it orbits, its corporation and,
 * for most, the operation ("Jita IV - Moon 4 - Caldari Navy Assembly Plant").
 */
export function stationName(
  station: RawStation,
  systemName: string,
  corporation: string,
  operation: string,
  planetName?: string,
): string {
  const owner = station.useOperationName ? `${corporation} ${operation}` : corporation;
  if (station.celestialIndex === undefined) return `${systemName} - ${owner}`;
  const planet = planetName ?? `${systemName} ${roman(station.celestialIndex)}`;
  return station.orbitIndex === undefined
    ? `${planet} - ${owner}`
    : `${planet} - Moon ${station.orbitIndex} - ${owner}`;
}

/**
 * Stations of known space with their names, and the places Routes By looks for: CONCORD and DED
 * security offices in low-sec (https://wiki.eveuniversity.org/Security_tags), the stations with
 * NPC buy orders for blue and red loot, and the trade hubs' main stations.
 */
export function buildStations(input: StationInput): StationData {
  const operations = new Map(input.operations.map((o) => [o._key, o]));
  const corporations = new Map(input.corporations.map((c) => [c._key, c.name.en ?? String(c._key)]));
  const stations: StationData['stations'] = [];
  const securityOffice: number[] = [];
  for (const raw of [...input.stations].sort((a, b) => a._key - b._key)) {
    const system = input.systems.get(raw.solarSystemID);
    const operation = operations.get(raw.operationID);
    if (!system || !operation) continue;
    const corporation = corporations.get(raw.ownerID) ?? String(raw.ownerID);
    stations.push([
      raw._key,
      raw.solarSystemID,
      stationName(
        raw,
        system.name,
        corporation,
        operation.operationName.en ?? '',
        input.planetNames.get(`${raw.solarSystemID}:${raw.celestialIndex}`),
      ),
    ]);
    const lowSec = system.security > 0 && system.security < 0.45;
    if (
      lowSec &&
      operation.services.includes(SECURITY_OFFICE_SERVICE) &&
      SECURITY_OFFICE_OWNERS.includes(raw.ownerID)
    ) {
      securityOffice.push(raw._key);
    }
  }
  const known = new Set(stations.map((s) => s[0]));
  const only = (ids: readonly number[]) => [...new Set(ids)].filter((id) => known.has(id)).sort((a, b) => a - b);
  const date = input.meta.releaseDate ? ` (${input.meta.releaseDate.slice(0, 10)})` : '';
  return {
    source: `SDE build ${input.meta.buildNumber}${date}; loot buyers: ${input.buyOrdersSource}`,
    stations,
    places: {
      securityOffice,
      blueLoot: only(input.blueLoot),
      redLoot: only(input.redLoot),
      tradeHubs: only(TRADE_HUB_STATIONS),
    },
  };
}

/** One line per station, so a rebuild gives a readable diff. */
export function formatStations(data: StationData): string {
  const ids = (list: readonly number[]) => JSON.stringify(list);
  return [
    '{',
    `  "source": ${JSON.stringify(data.source)},`,
    '  "places": {',
    Object.entries(data.places)
      .map(([key, list]) => `    ${JSON.stringify(key)}: ${ids(list)}`)
      .join(',\n'),
    '  },',
    `  "stations": [\n${data.stations.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]`,
    '}',
    '',
  ].join('\n');
}

const ESI = 'https://esi.evetech.net';

/**
 * NPC stations with standing buy orders for any of `typeIds`, read from ESI's regional markets.
 * NPC buy orders are the ones that last 365 days at an NPC station (ids from 60000000 to
 * 64000000); players cannot place orders that long.
 */
export async function npcBuyStations(
  typeIds: readonly number[],
  regionIds: readonly number[],
  fetchJson: (url: string) => Promise<unknown>,
): Promise<number[]> {
  const found = new Set<number>();
  for (const region of regionIds) {
    for (const type of typeIds) {
      for (let page = 1; page <= 20; page++) {
        const orders = (await fetchJson(
          `${ESI}/markets/${region}/orders/?order_type=buy&type_id=${type}&page=${page}`,
        )) as Array<{ location_id: number; duration: number; is_buy_order: boolean }> | null;
        if (!orders || orders.length === 0) break;
        for (const o of orders) {
          if (o.is_buy_order && o.duration === 365 && o.location_id >= 60_000_000 && o.location_id < 64_000_000)
            found.add(o.location_id);
        }
        if (orders.length < 1000) break;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}
