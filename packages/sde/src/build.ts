import type { SdeConstellation, SdeRegion, SdeSolarSystem, UniverseData } from './index.js';

/** The SDE files (JSON Lines) the universe data is built from. */
export const SDE_FILES = {
  meta: '_sde.jsonl',
  regions: 'mapRegions.jsonl',
  constellations: 'mapConstellations.jsonl',
  systems: 'mapSolarSystems.jsonl',
  stargates: 'mapStargates.jsonl',
} as const;

type Localized = { en?: string };

interface RawRegion {
  _key: number;
  name: Localized;
  wormholeClassID?: number;
}

interface RawConstellation extends RawRegion {
  regionID: number;
}

interface RawSystem extends RawConstellation {
  constellationID: number;
  securityStatus: number;
}

interface RawStargate {
  solarSystemID: number;
  destination: { solarSystemID: number };
}

export interface SdeInput {
  meta: { buildNumber: number; releaseDate?: string };
  regions: RawRegion[];
  constellations: RawConstellation[];
  systems: RawSystem[];
  stargates: RawStargate[];
}

/** Known space (30xxxxxx) and wormhole space (31xxxxxx); abyssal and void pockets are left out. */
const isMappable = (id: number) => id >= 30_000_000 && id < 32_000_000;

export function parseJsonl<T>(text: string): T[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/**
 * Turns the raw SDE map files into the compact universe dataset. The wormhole class is
 * inherited system -> constellation -> region; the few systems without one (Zarzakh, new
 * regions) fall back to the class their security status implies.
 */
export function buildUniverse(input: SdeInput): UniverseData {
  const regionById = new Map(input.regions.map((r) => [r._key, r]));
  const constellationById = new Map(input.constellations.map((c) => [c._key, c]));

  const gates = new Map<number, Set<number>>();
  for (const gate of input.stargates) {
    const from = gate.solarSystemID;
    const to = gate.destination.solarSystemID;
    if (!gates.has(from)) gates.set(from, new Set());
    gates.get(from)!.add(to);
  }

  const systems: SdeSolarSystem[] = [];
  for (const raw of input.systems) {
    if (!isMappable(raw._key)) continue;
    const constellation = constellationById.get(raw.constellationID);
    const region = regionById.get(raw.regionID);
    if (!constellation || !region)
      throw new Error(`system ${raw._key} has an unknown region or constellation`);
    systems.push({
      id: raw._key,
      name: englishName(raw),
      regionId: raw.regionID,
      constellationId: raw.constellationID,
      security: raw.securityStatus,
      whClass:
        raw.wormholeClassID ??
        constellation.wormholeClassID ??
        region.wormholeClassID ??
        classFromSecurity(raw.securityStatus),
      gates: [...(gates.get(raw._key) ?? [])].filter(isMappable).sort((a, b) => a - b),
    });
  }
  systems.sort((a, b) => a.id - b.id);

  const usedRegions = new Set(systems.map((s) => s.regionId));
  const usedConstellations = new Set(systems.map((s) => s.constellationId));
  const regions: SdeRegion[] = input.regions
    .filter((r) => usedRegions.has(r._key))
    .map((r) => ({ id: r._key, name: englishName(r) }))
    .sort((a, b) => a.id - b.id);
  const constellations: SdeConstellation[] = input.constellations
    .filter((c) => usedConstellations.has(c._key))
    .map((c) => ({ id: c._key, name: englishName(c), regionId: c.regionID }))
    .sort((a, b) => a.id - b.id);

  const date = input.meta.releaseDate ? ` (${input.meta.releaseDate.slice(0, 10)})` : '';
  return { source: `SDE build ${input.meta.buildNumber}${date}`, regions, constellations, systems };
}

/** High (7) from 0.45 up, which displays as 0.5; low (8) above 0.0; null (9) otherwise. */
export function classFromSecurity(security: number): number {
  if (security >= 0.45) return 7;
  if (security > 0) return 8;
  return 9;
}

function englishName(entry: { _key: number; name: Localized }): string {
  const name = entry.name.en;
  if (!name) throw new Error(`entry ${entry._key} has no English name`);
  return name;
}

/**
 * Serializes the dataset with one entry per line, so a new SDE build gives a readable diff.
 */
export function formatUniverse(data: UniverseData): string {
  const lines = (items: readonly unknown[]) => items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  return [
    '{',
    `  "source": ${JSON.stringify(data.source)},`,
    `  "regions": [\n${lines(data.regions)}\n  ],`,
    `  "constellations": [\n${lines(data.constellations)}\n  ],`,
    `  "systems": [\n${lines(data.systems)}\n  ]`,
    '}',
    '',
  ].join('\n');
}
