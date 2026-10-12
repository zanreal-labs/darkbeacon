import {
  JUMP_FLAG_POCHVEN,
  JUMP_FLAG_STATION,
  JUMP_FLAG_ZARZAKH,
  type JumpUniverseDto,
} from '@darkbeacon/shared';
import { SECURITY_COLORS, shownSecurity } from '../map/nodeFacts';

/** True security from which a system is high-sec (0.45 shows as 0.5). */
export const HIGH_SEC_MIN = 0.45;

/** Grid cell (ly) for finding the system under the pointer. */
const HIT_CELL = 2;

/**
 * Known space ready to draw: positions projected top-down like the in-game star map and Dotlan
 * (x to the east, z to the north, so screen y is -z), colours by security, region labels and a
 * grid for hit tests. Systems are addressed by their index in the dataset.
 */
export interface StarModel {
  size: number;
  ids: Int32Array;
  names: readonly string[];
  /** Lower-cased names, for search. */
  keys: readonly string[];
  regionOf: Uint16Array;
  regionIds: Int32Array;
  regionNames: readonly string[];
  security: Float32Array;
  /** Projected position in ly: px = x, py = -z. */
  px: Float32Array;
  py: Float32Array;
  /** 3D position in ly, for distances. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  flags: Uint8Array;
  /** Index into `COLOR_BUCKETS` per system. */
  bucket: Uint8Array;
  /** Stargates as index pairs. */
  gates: Int32Array;
  /** Region label positions (centroid of its systems) and how many systems it has. */
  /** `scattered`: Pochven, whose systems lie all over New Eden (no label at its middle). */
  regions: Array<{ name: string; px: number; py: number; count: number; scattered: boolean }>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  indexById: ReadonlyMap<number, number>;
  grid: ReadonlyMap<number, number[]>;
}

/** Colour buckets: the eleven displayed security levels, then Pochven and Zarzakh. */
export const COLOR_BUCKETS: readonly string[] = [
  ...['0.0', '0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0'].map(
    (level) => SECURITY_COLORS[level]!,
  ),
  // Pochven and Zarzakh are drawn in the theme's special-space colour (see draw.ts).
  'special',
  'special',
];
export const BUCKET_POCHVEN = 11;
export const BUCKET_ZARZAKH = 12;

export function securityBucket(security: number): number {
  const shown = shownSecurity(security);
  return Math.round(Math.max(0, Math.min(1, shown)) * 10);
}

const cellKey = (cx: number, cy: number) => (cx + 1024) * 4096 + (cy + 1024);

export function buildStarModel(data: JumpUniverseDto): StarModel {
  const s = data.systems;
  const size = s.id.length;
  const px = new Float32Array(size);
  const py = new Float32Array(size);
  const bucket = new Uint8Array(size);
  const flags = Uint8Array.from(s.flags);
  const regionOf = Uint16Array.from(s.region);
  const indexById = new Map<number, number>();
  const grid = new Map<number, number[]>();
  const sums = data.regions.map(() => ({ x: 0, y: 0, n: 0, pochven: false }));
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < size; i++) {
    px[i] = s.x[i]!;
    py[i] = -s.z[i]!;
    indexById.set(s.id[i]!, i);
    bucket[i] =
      flags[i]! & JUMP_FLAG_POCHVEN
        ? BUCKET_POCHVEN
        : flags[i]! & JUMP_FLAG_ZARZAKH
          ? BUCKET_ZARZAKH
          : securityBucket(s.security[i]!);
    const key = cellKey(Math.floor(px[i]! / HIT_CELL), Math.floor(py[i]! / HIT_CELL));
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
    const sum = sums[regionOf[i]!]!;
    sum.x += px[i]!;
    sum.y += py[i]!;
    sum.n += 1;
    if (flags[i]! & JUMP_FLAG_POCHVEN) sum.pochven = true;
    bounds.minX = Math.min(bounds.minX, px[i]!);
    bounds.maxX = Math.max(bounds.maxX, px[i]!);
    bounds.minY = Math.min(bounds.minY, py[i]!);
    bounds.maxY = Math.max(bounds.maxY, py[i]!);
  }
  return {
    size,
    ids: Int32Array.from(s.id),
    names: s.name,
    keys: s.name.map((n) => n.toLowerCase()),
    regionOf,
    regionIds: Int32Array.from(data.regions.map((r) => r.id)),
    regionNames: data.regions.map((r) => r.name),
    security: Float32Array.from(s.security),
    px,
    py,
    x: Float32Array.from(s.x),
    y: Float32Array.from(s.y),
    z: Float32Array.from(s.z),
    flags,
    bucket,
    gates: Int32Array.from(data.gates),
    regions: data.regions
      .map((r, i) => ({
        name: r.name,
        px: sums[i]!.x / sums[i]!.n,
        py: sums[i]!.y / sums[i]!.n,
        count: sums[i]!.n,
        scattered: sums[i]!.pochven,
      }))
      .filter((r) => r.count > 0),
    bounds,
    indexById,
    grid,
  };
}

/** Distance in light years between two systems. */
export function distanceLy(model: StarModel, a: number, b: number): number {
  const dx = model.x[a]! - model.x[b]!;
  const dy = model.y[a]! - model.y[b]!;
  const dz = model.z[a]! - model.z[b]!;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The system nearest to a projected point within `radius` ly, or -1. */
export function systemAt(model: StarModel, x: number, y: number, radius: number): number {
  let best = -1;
  let bestD = radius * radius;
  const reach = Math.ceil(radius / HIT_CELL);
  const cx = Math.floor(x / HIT_CELL);
  const cy = Math.floor(y / HIT_CELL);
  for (let a = cx - reach; a <= cx + reach; a++)
    for (let b = cy - reach; b <= cy + reach; b++) {
      for (const i of model.grid.get(cellKey(a, b)) ?? []) {
        const dx = model.px[i]! - x;
        const dy = model.py[i]! - y;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  return best;
}

/** Name search: prefix matches first (alphabetical), then substring matches. */
export function searchSystems(model: StarModel, text: string, limit = 8): number[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const prefix: number[] = [];
  const inside: number[] = [];
  for (let i = 0; i < model.size; i++) {
    const key = model.keys[i]!;
    if (key.startsWith(q)) prefix.push(i);
    else if (key.includes(q)) inside.push(i);
  }
  const byName = (a: number, b: number) => model.keys[a]!.localeCompare(model.keys[b]!);
  return [...prefix.sort(byName), ...inside.sort(byName)].slice(0, limit);
}

export function isHighSec(model: StarModel, i: number): boolean {
  return model.security[i]! >= HIGH_SEC_MIN;
}

export function hasStation(model: StarModel, i: number): boolean {
  return (model.flags[i]! & JUMP_FLAG_STATION) !== 0;
}

/**
 * Why no cyno can be lit in a system (so no jump drive lands there), or null when one can. The
 * same rules as the planner: not in high-sec, Pochven or Zarzakh.
 */
export function noCynoReason(model: StarModel, i: number): string | null {
  if (model.flags[i]! & JUMP_FLAG_POCHVEN) return 'Pochven: jump drives cannot enter';
  if (model.flags[i]! & JUMP_FLAG_ZARZAKH) return 'Zarzakh: no capitals, no jump drives';
  if (isHighSec(model, i)) return 'High-sec: no cynos';
  return null;
}

/** Security as the game shows it, e.g. "0.4", "-0.3". */
export function securityLabel(security: number): string {
  return shownSecurity(security).toFixed(1);
}

export function securityColor(security: number): string {
  return COLOR_BUCKETS[securityBucket(security)]!;
}
