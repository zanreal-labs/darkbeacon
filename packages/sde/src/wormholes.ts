import type { HullClassData, WormholeData, WormholeSystemFacts, WormholeTypeData } from './index.js';

/** SDE files the wormhole dataset is built from (besides `_sde.jsonl`). */
export const WORMHOLE_SDE_FILES = {
  groups: 'groups.jsonl',
  types: 'types.jsonl',
  typeDogma: 'typeDogma.jsonl',
  secondarySuns: 'mapSecondarySuns.jsonl',
} as const;

/** The SDE inventory group of wormholes ("Wormhole", category Celestial). */
export const WORMHOLE_GROUP_ID = 988;
/** The SDE inventory category of ships. */
export const SHIP_CATEGORY_ID = 6;

/**
 * Dogma attributes of wormhole types, by id and name as `dogmaAttributes.jsonl` lists them
 * (SDE build 3586130). `wormholeMaxStableTime` is in minutes although its unit says seconds:
 * 1440 is the 24 hours a static to high-sec lives.
 */
export const WORMHOLE_ATTRIBUTES = {
  targetSystemClass: 1381, // wormholeTargetSystemClass
  maxStableTime: 1382, // wormholeMaxStableTime
  maxStableMass: 1383, // wormholeMaxStableMass
  massRegeneration: 1384, // wormholeMassRegeneration
  maxJumpMass: 1385, // wormholeMaxJumpMass
  targetDistribution: 1457, // wormholeTargetDistribution
} as const;

/**
 * Hull classes for "which ships fit through", as SDE ship groups. Supercarriers and titans are
 * left out: they cannot use wormholes at all (https://wiki.eveuniversity.org/Wormholes).
 */
export const HULL_CLASS_GROUPS: ReadonlyArray<{ id: HullClassData['id']; groups: readonly number[] }> = [
  // Frigate, Assault Frigate, Interceptor, Covert Ops, Electronic Attack Ship, Stealth Bomber,
  // Expedition Frigate, Logistics Frigate, Corvette, Prototype Exploration Ship, Shuttle.
  { id: 'frigate', groups: [25, 324, 831, 830, 893, 834, 1283, 1527, 237, 1022, 31] },
  // Destroyer, Interdictor, Command Destroyer, Tactical Destroyer.
  { id: 'destroyer', groups: [420, 541, 1534, 1305] },
  // Cruiser, Heavy Assault Cruiser, Force Recon, Combat Recon, Logistics, Strategic Cruiser,
  // Heavy Interdiction Cruiser, Flag Cruiser.
  { id: 'cruiser', groups: [26, 358, 833, 906, 832, 963, 894, 1972] },
  // Combat and Attack Battlecruiser, Command Ship, Expedition Command Ship.
  { id: 'battlecruiser', groups: [419, 1201, 540, 4902] },
  // Hauler, Blockade Runner, Deep Space Transport, Mining Barge, Exhumer.
  { id: 'industrial', groups: [28, 1202, 380, 463, 543] },
  // Battleship, Black Ops, Marauder.
  { id: 'battleship', groups: [27, 898, 900] },
  // Industrial Command Ship (Orca, Porpoise).
  { id: 'industrialCommand', groups: [941] },
  // Freighter, Jump Freighter.
  { id: 'freighter', groups: [513, 902] },
  // Carrier, Command Carrier, Dreadnought, Lancer Dreadnought, Force Auxiliary, Capital Industrial Ship.
  { id: 'capital', groups: [547, 5120, 485, 4594, 1538, 883] },
];

/** The effect beacon's name ("Class 3 Wolf Rayet Effects") -> effect id. */
const EFFECT_NAMES: ReadonlyArray<[string, string]> = [
  ['Black Hole', 'blackHole'],
  ['Cataclysmic Variable', 'cataclysmicVariable'],
  ['Magnetar', 'magnetar'],
  ['Pulsar', 'pulsar'],
  ['Red Giant', 'redGiant'],
  ['Wolf Rayet', 'wolfRayet'],
];

type Localized = { en?: string };

export interface RawType {
  _key: number;
  groupID: number;
  name: Localized;
  mass?: number;
  published?: boolean;
}

export interface RawGroup {
  _key: number;
  categoryID: number;
  name: Localized;
}

export interface RawTypeDogma {
  _key: number;
  dogmaAttributes: Array<{ attributeID: number; value: number }>;
}

export interface RawSecondarySun {
  solarSystemID: number;
  effectBeaconTypeID: number;
  typeID: number;
}

/** One row of the statics table: system id and its static wormhole type codes. */
export interface StaticsRow {
  solarSystemId: number;
  statics: string[];
}

export interface WormholeInput {
  meta: { buildNumber: number; releaseDate?: string };
  groups: RawGroup[];
  /** Wormhole and ship types; other types are ignored. */
  types: RawType[];
  /** Dogma of at least the wormhole types. */
  typeDogma: RawTypeDogma[];
  secondarySuns: RawSecondarySun[];
  statics: StaticsRow[];
  /** Where the statics came from, for the dataset's `source`. */
  staticsSource: string;
}

/** Wormhole codes are the type name without "Wormhole " ("Wormhole D845" -> "D845"). */
function wormholeCode(type: RawType): string | null {
  const match = /^Wormhole ([A-Z]\d{3})$/.exec(type.name.en ?? '');
  return match ? match[1]! : null;
}

/**
 * Builds the wormhole dataset: wormhole types and their attributes (SDE), hull classes and ship
 * masses (SDE), each wormhole system's effect (SDE secondary suns) and statics (the statics table).
 */
export function buildWormholes(input: WormholeInput): WormholeData {
  const groups = new Map(input.groups.map((g) => [g._key, g]));
  const dogma = new Map(
    input.typeDogma.map((d) => [d._key, new Map(d.dogmaAttributes.map((a) => [a.attributeID, a.value]))]),
  );

  const types: WormholeTypeData[] = [];
  const seen = new Set<string>();
  const wormholes = input.types
    .filter((t) => t.groupID === WORMHOLE_GROUP_ID)
    .sort((a, b) => a._key - b._key);
  for (const type of wormholes) {
    const code = wormholeCode(type);
    // QA wormholes have no code; variants of one code (C729, J244) share their attributes.
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const attrs = dogma.get(type._key) ?? new Map<number, number>();
    const attr = (id: number) => attrs.get(id) ?? null;
    types.push({
      code,
      typeId: type._key,
      targetClass: attr(WORMHOLE_ATTRIBUTES.targetSystemClass),
      maxStableTimeMinutes: attr(WORMHOLE_ATTRIBUTES.maxStableTime),
      maxStableMass: attr(WORMHOLE_ATTRIBUTES.maxStableMass),
      maxJumpMass: attr(WORMHOLE_ATTRIBUTES.maxJumpMass),
      massRegeneration: attr(WORMHOLE_ATTRIBUTES.massRegeneration),
      targetDistribution: attr(WORMHOLE_ATTRIBUTES.targetDistribution),
    });
  }
  types.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const shipMasses: Record<string, number> = {};
  const classOfGroup = new Map<number, HullClassData['id']>();
  for (const hull of HULL_CLASS_GROUPS) for (const g of hull.groups) classOfGroup.set(g, hull.id);
  const classMass = new Map<HullClassData['id'], { min: number; max: number }>();
  for (const type of input.types) {
    if (groups.get(type.groupID)?.categoryID !== SHIP_CATEGORY_ID || !type.mass) continue;
    shipMasses[type._key] = type.mass;
    const hull = classOfGroup.get(type.groupID);
    if (!hull || !type.published) continue;
    const range = classMass.get(hull) ?? { min: Infinity, max: 0 };
    classMass.set(hull, { min: Math.min(range.min, type.mass), max: Math.max(range.max, type.mass) });
  }
  const hullClasses: HullClassData[] = HULL_CLASS_GROUPS.map((hull) => {
    const range = classMass.get(hull.id);
    if (!range) throw new Error(`no published ships in hull class ${hull.id}`);
    return { id: hull.id, minMass: range.min, maxMass: range.max };
  });

  const typeNames = new Map(input.types.map((t) => [t._key, t.name.en ?? '']));
  const systems: Record<string, WormholeSystemFacts> = {};
  for (const row of input.statics) {
    systems[row.solarSystemId] = { statics: row.statics, effect: null };
  }
  for (const sun of input.secondarySuns) {
    // The beacon applies the effect; the sun type only looks like one (they differ in two systems).
    const beacon = typeNames.get(sun.effectBeaconTypeID) ?? '';
    const effect = EFFECT_NAMES.find(([name]) => beacon.includes(name))?.[1] ?? null;
    if (!effect) continue;
    const entry = (systems[sun.solarSystemID] ??= { statics: [], effect: null });
    entry.effect = effect;
  }
  const sortedSystems = Object.fromEntries(
    Object.entries(systems).sort(([a], [b]) => Number(a) - Number(b)),
  ) as Record<string, WormholeSystemFacts>;

  const date = input.meta.releaseDate ? ` (${input.meta.releaseDate.slice(0, 10)})` : '';
  return {
    source: `SDE build ${input.meta.buildNumber}${date}; statics: ${input.staticsSource}`,
    types,
    hullClasses,
    shipMasses,
    systems: sortedSystems,
  };
}

/**
 * Reads the statics table (CSV with a header row; `id` = solar system id, `statics` = comma
 * separated type codes in one quoted field). Only wormhole space (31xxxxxx) is kept.
 */
export function parseStaticsCsv(text: string): StaticsRow[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new Error('statics table is empty');
  const id = header.indexOf('id');
  const statics = header.indexOf('statics');
  if (id < 0 || statics < 0) throw new Error('statics table needs "id" and "statics" columns');
  const result: StaticsRow[] = [];
  for (const row of rows) {
    const solarSystemId = Number(row[id]);
    if (!(solarSystemId >= 31_000_000 && solarSystemId < 32_000_000)) continue;
    const codes = (row[statics] ?? '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => /^[A-Z]\d{3}$/.test(code));
    result.push({ solarSystemId, statics: codes });
  }
  return result;
}

/** RFC 4180 CSV: quoted fields with doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** One entry per line, like `universe.json`, so a new build gives a readable diff. */
export function formatWormholes(data: WormholeData): string {
  const lines = (items: readonly unknown[]) => items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  const entries = (record: Record<string, unknown>) =>
    Object.entries(record)
      .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join(',\n');
  return [
    '{',
    `  "source": ${JSON.stringify(data.source)},`,
    `  "types": [\n${lines(data.types ?? [])}\n  ],`,
    `  "hullClasses": [\n${lines(data.hullClasses ?? [])}\n  ],`,
    `  "shipMasses": {\n${entries(data.shipMasses ?? {})}\n  },`,
    `  "systems": {\n${entries(data.systems)}\n  }`,
    '}',
    '',
  ].join('\n');
}
