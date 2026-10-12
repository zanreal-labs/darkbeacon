import type {
  HullClassData,
  MassModifierData,
  PropSizeData,
  ShipData,
  WormholeData,
  WormholeSystemFacts,
  WormholeTypeData,
} from './index.js';

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

/** SDE inventory groups of the modules that change a ship's mass when it jumps. */
export const MASS_MODULE_GROUPS = {
  /** Afterburners and microwarpdrives. */
  propulsion: 46,
  /** Higgs Anchor rigs. */
  rigAnchor: 1308,
  /** Zero-Point Mass Entangler. */
  massEntangler: 2008,
} as const;

/** Strategic cruisers take their slots from subsystems, so the hull lists no mid slots. */
const STRATEGIC_CRUISER_GROUP_ID = 963;

/** Dogma attributes of ships and mass modules, by id as `dogmaAttributes.jsonl` names them. */
export const MASS_ATTRIBUTES = {
  medSlots: 13, // medSlots
  rigSlots: 1137, // rigSlots
  rigSize: 1547, // rigSize: 1 small, 2 medium, 3 large, 4 capital
  massAddition: 796, // massAddition: "adding mass to a ship via an afterburner or MWD"
  massBonusPercentage: 1131, // massBonusPercentage, applied to `mass` as a post-percent modifier
} as const;

/** `canFitShipGroup01`..`20` and `canFitShipType1`..`12`: where a restricted module fits. */
const CAN_FIT_GROUP_ATTRIBUTES = [
  1298, 1299, 1300, 1301, 1872, 1879, 1880, 1881, 2065, 2396, 2476, 2477, 2478, 2479, 2480, 2481, 2482, 2483,
  2484, 2485,
];
const CAN_FIT_TYPE_ATTRIBUTES = [1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487, 2488, 2758, 5948];

const RIG_SIZES: Record<number, PropSizeData> = { 1: 'small', 2: 'medium', 3: 'large', 4: 'capital' };

/** Prop module size by the MN in its name: 1MN AB and 5MN MWD are small, and so on. */
const PROP_SIZE_BY_MN: Record<string, PropSizeData> = {
  '1': 'small',
  '5': 'small',
  '10': 'medium',
  '50': 'medium',
  '100': 'large',
  '500': 'large',
  '10000': 'capital',
  '50000': 'capital',
};

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
  /** Wormhole, ship and mass module types; other types are ignored. */
  types: RawType[];
  /** Dogma of at least the wormhole, ship and mass module types. */
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

  const { ships, massModifiers } = shipFacts(input, groups, dogma, classOfGroup);

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
    ships,
    massModifiers,
    systems: sortedSystems,
  };
}

type Dogma = Map<number, Map<number, number>>;

/**
 * Published ships (name, group, prop size, rig slots, whether the mass entangler fits) and the
 * mass modules' dogma. Every published prop module of one size must add the same mass, and every
 * Higgs Anchor the same percentage; a new SDE that breaks that fails the build instead of guessing.
 */
function shipFacts(
  input: WormholeInput,
  groups: Map<number, RawGroup>,
  dogma: Dogma,
  classOfGroup: Map<number, HullClassData['id']>,
): { ships: ShipData[]; massModifiers: MassModifierData } {
  const attr = (typeId: number, id: number) => dogma.get(typeId)?.get(id) ?? null;
  const published = (groupId: number) =>
    input.types.filter((t) => t.groupID === groupId && t.published).sort((a, b) => a._key - b._key);

  const prop: Partial<Record<PropSizeData, number>> = {};
  for (const module of published(MASS_MODULE_GROUPS.propulsion)) {
    const added = attr(module._key, MASS_ATTRIBUTES.massAddition);
    // Abyssal modules are rolled from a base module and list no mass of their own.
    if (added === null) continue;
    const mn = /(\d+)MN\b/.exec(module.name.en ?? '')?.[1];
    const size = mn ? PROP_SIZE_BY_MN[mn] : undefined;
    if (!size) throw new Error(`propulsion module ${module.name.en} has no known size`);
    if (prop[size] !== undefined && prop[size] !== added)
      throw new Error(`${size} propulsion modules add different masses (${prop[size]}, ${added})`);
    prop[size] = added;
  }
  const one = (groupId: number, what: string) => {
    const values = new Set(
      published(groupId).map((t) => attr(t._key, MASS_ATTRIBUTES.massBonusPercentage) ?? 0),
    );
    if (values.size !== 1) throw new Error(`${what} change mass by ${[...values].join(', ') || 'nothing'}`);
    return [...values][0]!;
  };
  for (const size of Object.values(RIG_SIZES))
    if (prop[size] === undefined) throw new Error(`no ${size} propulsion module`);
  const massModifiers: MassModifierData = {
    prop: Object.fromEntries(Object.values(RIG_SIZES).map((size) => [size, prop[size]!])) as Record<
      PropSizeData,
      number
    >,
    higgsPercent: one(MASS_MODULE_GROUPS.rigAnchor, 'Higgs Anchors'),
    entanglerPercent: one(MASS_MODULE_GROUPS.massEntangler, 'mass entanglers'),
  };

  const entanglerGroups = new Set<number>();
  const entanglerTypes = new Set<number>();
  for (const module of published(MASS_MODULE_GROUPS.massEntangler)) {
    for (const id of CAN_FIT_GROUP_ATTRIBUTES) {
      const value = attr(module._key, id);
      if (value) entanglerGroups.add(value);
    }
    for (const id of CAN_FIT_TYPE_ATTRIBUTES) {
      const value = attr(module._key, id);
      if (value) entanglerTypes.add(value);
    }
  }

  const ships: ShipData[] = [];
  for (const type of input.types) {
    const group = groups.get(type.groupID);
    if (group?.categoryID !== SHIP_CATEGORY_ID || !type.published || !type.mass) continue;
    const medSlots = attr(type._key, MASS_ATTRIBUTES.medSlots) ?? 0;
    const rigSize = attr(type._key, MASS_ATTRIBUTES.rigSize);
    const fitsProp = medSlots > 0 || type.groupID === STRATEGIC_CRUISER_GROUP_ID;
    ships.push({
      id: type._key,
      name: type.name.en ?? String(type._key),
      group: group.name.en ?? '',
      hull: classOfGroup.get(type.groupID) ?? null,
      // Rookie ships, corvettes and shuttles list no rig size: they fit the small modules.
      propSize: fitsProp ? (RIG_SIZES[rigSize ?? 1] ?? 'small') : null,
      rigs: (attr(type._key, MASS_ATTRIBUTES.rigSlots) ?? 0) > 0,
      entangler: entanglerGroups.has(type.groupID) || entanglerTypes.has(type._key),
    });
  }
  ships.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  return { ships, massModifiers };
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
    `  "ships": [\n${lines(data.ships ?? [])}\n  ],`,
    `  "massModifiers": ${JSON.stringify(data.massModifiers ?? null)},`,
    `  "systems": {\n${entries(data.systems)}\n  }`,
    '}',
    '',
  ].join('\n');
}
