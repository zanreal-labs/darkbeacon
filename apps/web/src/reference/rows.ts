import {
  HULL_CLASS_LABEL,
  ShipSize,
  SPAWN_AREA_LABEL,
  WORMHOLE_DESTINATION_LABEL,
  WORMHOLE_SPAWNS,
  WormholeDestination,
  type HullClass,
  type WormholeRespawn,
  type WormholeTypeDto,
} from '@darkbeacon/shared';

/**
 * One row of the wormhole types reference. Where it leads, its lifetime, masses and the ship size
 * come from the catalog (`GET /api/universe/wormholes`, built from the SDE's wormhole dogma in
 * `packages/sde/data/wormholes.json`); where it spawns and how it respawns from `WORMHOLE_SPAWNS`
 * (the type tables of the EVE University wiki), which the SDE does not have.
 */
export interface ReferenceRow {
  code: string;
  destination: WormholeDestination | null;
  /** `WormholeDestination` words plus `c4-shattered`..`c6-shattered` and `jove`; empty for K162. */
  spawnsIn: readonly string[];
  respawn: readonly WormholeRespawn[];
  lifetimeHours: number | null;
  totalMass: number | null;
  maxJumpMass: number | null;
  massRegeneration: number | null;
  size: ShipSize | null;
  /** Hull classes whose heaviest hull fits through in one jump. */
  fits: readonly HullClass[];
}

export type ReferenceSortKey =
  'code' | 'destination' | 'spawns' | 'lifetime' | 'totalMass' | 'maxJumpMass' | 'size' | 'respawn';

export interface ReferenceSort {
  key: ReferenceSortKey;
  dir: 'asc' | 'desc';
}

export interface ReferenceFilter {
  /** Words that must all appear (code, where it leads or spawns, respawn, lifetime, masses). */
  query: string;
  /** Only types that lead here. */
  destination: WormholeDestination | 'all';
  /** Only types that are some system's static. */
  staticsOnly: boolean;
}

export const DEFAULT_FILTER: ReferenceFilter = { query: '', destination: 'all', staticsOnly: false };
export const DEFAULT_SORT: ReferenceSort = { key: 'code', dir: 'asc' };

/** Ship sizes smallest first, as the map's connections letter them. */
export const SHIP_SIZES: readonly ShipSize[] = ShipSize.options;

/** The order classes are listed in: C1-C6, high, low, null, then the special places. */
const DESTINATIONS: readonly WormholeDestination[] = WormholeDestination.options;
const AREAS: readonly string[] = [...DESTINATIONS, 'c4-shattered', 'c5-shattered', 'c6-shattered', 'jove'];

const areaRank = (area: string) => {
  const at = AREAS.indexOf(area);
  return at < 0 ? AREAS.length : at;
};

/** "C5", "C4 shattered", "Jove". */
export function areaLabel(area: string): string {
  return SPAWN_AREA_LABEL[area] ?? WORMHOLE_DESTINATION_LABEL[area as WormholeDestination] ?? area;
}

/** Every type of the catalog with its spawn data, K162 included (it has no numbers of its own). */
export function referenceRows(types: readonly WormholeTypeDto[]): ReferenceRow[] {
  return types.map((t) => {
    const spawns = WORMHOLE_SPAWNS[t.code];
    return {
      code: t.code,
      destination: t.destination,
      spawnsIn: [...(spawns?.spawnsIn ?? [])].sort((a, b) => areaRank(a) - areaRank(b)),
      respawn: spawns?.respawn ?? [],
      lifetimeHours: t.lifetimeHours,
      totalMass: t.totalMass,
      maxJumpMass: t.maxJumpMass,
      massRegeneration: t.massRegeneration,
      size: t.shipSize,
      fits: t.fits,
    };
  });
}

/** What a row can be found by, lower-cased. */
function searchText(row: ReferenceRow): string {
  return [
    row.code,
    row.destination ?? '',
    row.destination ? WORMHOLE_DESTINATION_LABEL[row.destination] : '',
    ...row.spawnsIn.flatMap((a) => [a, areaLabel(a)]),
    ...row.respawn,
    row.lifetimeHours !== null ? `${row.lifetimeHours}h` : '',
    row.totalMass !== null ? String(row.totalMass / 1000) : '',
    row.maxJumpMass !== null ? String(row.maxJumpMass / 1000) : '',
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * The rows the filter leaves. A query that is exactly a type code shows only that type (opened
 * from a signature's "U210"); otherwise every word of it must appear somewhere in the row.
 */
export function filterRows(rows: readonly ReferenceRow[], filter: ReferenceFilter): ReferenceRow[] {
  const query = filter.query.trim().toLowerCase();
  const exact = rows.find((r) => r.code.toLowerCase() === query);
  const words = query.split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.destination !== 'all' && row.destination !== filter.destination) return false;
    if (filter.staticsOnly && !row.respawn.includes('static')) return false;
    if (exact) return row === exact;
    if (words.length === 0) return true;
    const text = searchText(row);
    return words.every((w) => text.includes(w));
  });
}

const RESPAWN_RANK: Record<WormholeRespawn, number> = { static: 0, wandering: 1, reverse: 2 };

/** The value a column sorts by; null sorts last whichever way. */
function sortValue(row: ReferenceRow, key: ReferenceSortKey): number | string | null {
  switch (key) {
    case 'code':
      return row.code;
    case 'destination':
      return row.destination ? DESTINATIONS.indexOf(row.destination) : null;
    case 'spawns':
      // By the first (lowest) class it spawns in, then by how many places.
      return row.spawnsIn.length ? areaRank(row.spawnsIn[0]!) * 100 + row.spawnsIn.length : null;
    case 'lifetime':
      return row.lifetimeHours;
    case 'totalMass':
      return row.totalMass;
    case 'maxJumpMass':
      return row.maxJumpMass;
    case 'size':
      return row.size ? SHIP_SIZES.indexOf(row.size) : null;
    case 'respawn':
      return row.respawn.length ? row.respawn.map((r) => RESPAWN_RANK[r]).join('') : null;
  }
}

/** Rows sorted by one column; ties and missing values keep code order. */
export function sortRows(rows: readonly ReferenceRow[], sort: ReferenceSort): ReferenceRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * sign;
    }
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/** A column's first sort: numbers read best biggest first, names and classes in their order. */
export function firstSort(key: ReferenceSortKey): ReferenceSort {
  const descending: ReferenceSortKey[] = ['lifetime', 'totalMass', 'maxJumpMass'];
  return { key, dir: descending.includes(key) ? 'desc' : 'asc' };
}

/** Clicking a column's header: sort by it, or turn it around when it already sorts. */
export function nextSort(current: ReferenceSort, key: ReferenceSortKey): ReferenceSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return firstSort(key);
}

/** A ship size of the legend: the heaviest jump of its types and the hulls it lets through. */
export interface SizeLegendEntry {
  size: ShipSize;
  /** kg: the largest max jump mass among the types of this size. */
  maxJumpMass: number;
  /** Every hull class that fits through a hole of this size. */
  fits: HullClass[];
  /** The ones that do not fit through the size below it. */
  adds: HullClass[];
}

/**
 * Which hulls fit through each size, from the catalog's own numbers (each type's `fits`: hull
 * classes whose heaviest published hull is under its jump mass). Sizes no type has are left out.
 */
export function sizeLegend(types: readonly WormholeTypeDto[]): SizeLegendEntry[] {
  const order = Object.keys(HULL_CLASS_LABEL) as HullClass[];
  const entries: SizeLegendEntry[] = [];
  let before = new Set<HullClass>();
  for (const size of SHIP_SIZES) {
    const ofSize = types.filter((t) => t.shipSize === size && t.maxJumpMass !== null);
    if (ofSize.length === 0) continue;
    const fits = new Set(ofSize.flatMap((t) => t.fits));
    const sorted = order.filter((h) => fits.has(h));
    entries.push({
      size,
      maxJumpMass: Math.max(...ofSize.map((t) => t.maxJumpMass!)),
      fits: sorted,
      adds: sorted.filter((h) => !before.has(h)),
    });
    before = fits;
  }
  return entries;
}

/** Lifetime as players say it: "16 h", "4.5 h". */
export function lifetimeText(hours: number | null): string {
  return hours === null ? '—' : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/**
 * Kilograms as whole tonnes with spaces, never abbreviated, so a column of masses lines up and
 * compares at a glance: "2 000 000 t", "375 000 t".
 */
export function tonnes(kg: number | null): string {
  if (kg === null) return '—';
  return `${Math.round(kg / 1000)
    .toLocaleString('en-US')
    .replaceAll(',', ' ')} t`;
}
