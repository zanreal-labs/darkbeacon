import type { JumpShipData, KspaceData, UniverseData } from './index.js';
import type { RawType, RawTypeDogma } from './wormholes.js';

/** The SDE files the k-space map needs besides the universe data. */
export const KSPACE_SDE_FILES = {
  stations: 'npcStations.jsonl',
} as const;

/** Metres in one light year (IAU: 9 460 730 472 580 800 m). */
export const METERS_PER_LY = 9_460_730_472_580_800;

/** Coordinates are kept in light years with this many decimals (about 6 AU). */
export const KSPACE_DECIMALS = 4;

/** Bits of `KspaceData.systems.flags`. */
export const KSPACE_FLAGS = {
  /** At least one NPC station. */
  station: 1,
  /** Pochven (SDE wormhole class 25). */
  pochven: 2,
  /** Zarzakh: jump drives do not work there and capitals cannot take its gates. */
  zarzakh: 4,
} as const;

/** Zarzakh, the Deathless system of Yasna Zakh. */
export const ZARZAKH_ID = 30100000;

export interface RawSystemPosition {
  _key: number;
  position: { x: number; y: number; z: number };
}

export interface RawStation {
  solarSystemID: number;
}

/**
 * Jump drive attributes of ships, by id and name as `dogmaAttributes.jsonl` lists them (SDE build
 * 3586130). `jumpDriveConsumptionAmount` is isotopes per light year; `jumpFatigueMultiplier` scales
 * the distance that counts for fatigue (0.1 for jump freighters and the Rorqual, 0.25 for black
 * ops); `jumpPortalConsumptionMassFactor` is the bridge fuel per kilogram bridged (titans, black ops).
 */
export const JUMP_ATTRIBUTES = {
  canJump: 861, // canJump
  fuelType: 866, // jumpDriveConsumptionType
  range: 867, // jumpDriveRange
  fuelPerLy: 868, // jumpDriveConsumptionAmount
  portalMassFactor: 1001, // jumpPortalConsumptionMassFactor
  fatigueMultiplier: 1971, // jumpFatigueMultiplier
} as const;

/** Isotope type ids (jumpDriveConsumptionType) by name. */
export const ISOTOPES: Readonly<Record<number, JumpShipData['isotope']>> = {
  16274: 'helium',
  17887: 'oxygen',
  17888: 'nitrogen',
  17889: 'hydrogen',
};

export interface KspaceInput {
  universe: UniverseData;
  positions: RawSystemPosition[];
  stations: RawStation[];
  /** Ship types (others are ignored). */
  types: RawType[];
  /** Dogma of at least the ships with a jump drive. */
  typeDogma: RawTypeDogma[];
}

/** Published ships with a jump drive and what the jump planner needs of them, by name. */
export function buildJumpShips(
  types: readonly RawType[],
  typeDogma: readonly RawTypeDogma[],
): JumpShipData[] {
  const dogma = new Map(
    typeDogma.map((d) => [d._key, new Map(d.dogmaAttributes.map((a) => [a.attributeID, a.value]))]),
  );
  const ships: JumpShipData[] = [];
  for (const type of types) {
    const attrs = dogma.get(type._key);
    if (!type.published || !attrs || !attrs.get(JUMP_ATTRIBUTES.canJump)) continue;
    const range = attrs.get(JUMP_ATTRIBUTES.range) ?? 0;
    if (range <= 0) continue;
    const isotope = ISOTOPES[attrs.get(JUMP_ATTRIBUTES.fuelType) ?? 0];
    if (!isotope) throw new Error(`ship ${type._key} burns an unknown jump fuel`);
    if (!type.name.en || type.mass === undefined) throw new Error(`ship ${type._key} has no name or mass`);
    ships.push({
      typeId: type._key,
      name: type.name.en,
      group: type.groupID,
      rangeLy: range,
      fuelPerLy: attrs.get(JUMP_ATTRIBUTES.fuelPerLy) ?? 0,
      isotope,
      fatigueMultiplier: attrs.get(JUMP_ATTRIBUTES.fatigueMultiplier) ?? 1,
      mass: type.mass,
      portalMassFactor: attrs.get(JUMP_ATTRIBUTES.portalMassFactor) ?? null,
    });
  }
  return ships.sort((a, b) => a.name.localeCompare(b.name));
}

const isKnownSpace = (id: number) => id >= 30_000_000 && id < 31_000_000;

function ly(meters: number): number {
  const scale = 10 ** KSPACE_DECIMALS;
  return Math.round((meters / METERS_PER_LY) * scale) / scale;
}

/**
 * Known-space systems the stargate network of New Eden reaches, plus Pochven (its own gate
 * network, entered through filaments and wormholes). The Jove regions are left out: most of their
 * systems have no stargate and the rest only link to each other.
 */
function reachableKnownSpace(universe: UniverseData): UniverseData['systems'] {
  const known = universe.systems.filter((s) => isKnownSpace(s.id));
  const byId = new Map(known.map((s) => [s.id, s]));
  const component = new Map<number, number>();
  const sizes: number[] = [];
  for (const start of known) {
    if (component.has(start.id)) continue;
    const label = sizes.length;
    let size = 0;
    const stack = [start.id];
    component.set(start.id, label);
    while (stack.length > 0) {
      const id = stack.pop()!;
      size += 1;
      for (const next of byId.get(id)?.gates ?? []) {
        if (!byId.has(next) || component.has(next)) continue;
        component.set(next, label);
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  return known.filter((s) => component.get(s.id) === main || s.whClass === 25);
}

/**
 * The k-space map: every known-space system people can reach (see `reachableKnownSpace`), with
 * its position in light years, region, security and flags, and the stargates between them as
 * pairs of indexes. Columnar, so the browser parses one array per field.
 */
export function buildKspace(input: KspaceInput): KspaceData {
  const positions = new Map(input.positions.map((p) => [p._key, p.position]));
  const stations = new Set(input.stations.map((s) => s.solarSystemID));
  const kept = reachableKnownSpace(input.universe);
  const regionIds = [...new Set(kept.map((s) => s.regionId))].sort((a, b) => a - b);
  const regionIndex = new Map(regionIds.map((id, i) => [id, i]));
  const regionNames = new Map(input.universe.regions.map((r) => [r.id, r.name]));
  const index = new Map(kept.map((s, i) => [s.id, i]));

  const systems: KspaceData['systems'] = {
    id: [],
    name: [],
    region: [],
    security: [],
    x: [],
    y: [],
    z: [],
    flags: [],
  };
  for (const s of kept) {
    const p = positions.get(s.id);
    if (!p) throw new Error(`system ${s.id} has no position`);
    let flags = 0;
    if (stations.has(s.id)) flags |= KSPACE_FLAGS.station;
    if (s.whClass === 25) flags |= KSPACE_FLAGS.pochven;
    if (s.id === ZARZAKH_ID) flags |= KSPACE_FLAGS.zarzakh;
    systems.id.push(s.id);
    systems.name.push(s.name);
    systems.region.push(regionIndex.get(s.regionId)!);
    systems.security.push(Math.round(s.security * 1e4) / 1e4);
    systems.x.push(ly(p.x));
    systems.y.push(ly(p.y));
    systems.z.push(ly(p.z));
    systems.flags.push(flags);
  }

  const gates: number[] = [];
  kept.forEach((s, i) => {
    for (const to of s.gates) {
      const j = index.get(to);
      if (j !== undefined && i < j) gates.push(i, j);
    }
  });

  return {
    version: 1,
    source: input.universe.source,
    regions: regionIds.map((id) => ({ id, name: regionNames.get(id) ?? String(id) })),
    systems,
    gates,
    ships: buildJumpShips(input.types, input.typeDogma),
  };
}

/** One field per line, so a new SDE build still gives a diff that can be read. */
export function formatKspace(data: KspaceData): string {
  const field = (name: string, values: readonly unknown[]) => `    "${name}": ${JSON.stringify(values)}`;
  const s = data.systems;
  return [
    '{',
    `  "version": ${data.version},`,
    `  "source": ${JSON.stringify(data.source)},`,
    `  "regions": ${JSON.stringify(data.regions)},`,
    '  "systems": {',
    [
      field('id', s.id),
      field('name', s.name),
      field('region', s.region),
      field('security', s.security),
      field('x', s.x),
      field('y', s.y),
      field('z', s.z),
      field('flags', s.flags),
    ].join(',\n'),
    '  },',
    `  "gates": ${JSON.stringify(data.gates)},`,
    `  "ships": [\n${data.ships.map((ship) => `    ${JSON.stringify(ship)}`).join(',\n')}\n  ]`,
    '}',
    '',
  ].join('\n');
}
