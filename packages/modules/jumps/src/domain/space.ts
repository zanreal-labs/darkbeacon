import type { JumpHull } from '@darkbeacon/shared';
import { hullOfGroup } from './hulls.js';

/** Known space as the k-space dataset has it (packages/sde, `data/kspace.json`), columnar. */
export interface JumpSpaceData {
  source: string;
  regions: ReadonlyArray<{ id: number; name: string }>;
  systems: {
    id: readonly number[];
    name: readonly string[];
    region: readonly number[];
    security: readonly number[];
    x: readonly number[];
    y: readonly number[];
    z: readonly number[];
    flags: readonly number[];
  };
  gates: readonly number[];
  ships: readonly JumpShipData[];
}

export interface JumpShipData {
  typeId: number;
  name: string;
  group: number;
  rangeLy: number;
  fuelPerLy: number;
  isotope: 'helium' | 'hydrogen' | 'nitrogen' | 'oxygen';
  fatigueMultiplier: number;
  mass: number;
  portalMassFactor: number | null;
}

export interface JumpShip extends JumpShipData {
  hull: JumpHull;
}

export const FLAG_STATION = 1;
export const FLAG_POCHVEN = 2;
export const FLAG_ZARZAKH = 4;

/**
 * High-sec from a true security of 0.45 up (shown as 0.5); the same rule as routing's
 * `isHighSec` (https://wiki.eveuniversity.org/System_security).
 */
export const HIGH_SEC_MIN = 0.45;

/** Grid cell edge in light years for neighbour searches. */
const CELL = 5;

/**
 * Indexed known space: positions, stargates and a grid for "every system within N ly". Systems
 * are addressed by their index in the dataset.
 */
export class JumpSpace {
  readonly size: number;
  readonly ships: readonly JumpShip[];
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly index = new Map<number, number>();
  private readonly gateStart: Int32Array;
  private readonly gateList: Int32Array;
  private readonly grid = new Map<number, number[]>();
  private readonly regionName = new Map<number, string>();

  constructor(readonly data: JumpSpaceData) {
    const s = data.systems;
    this.size = s.id.length;
    this.x = Float64Array.from(s.x);
    this.y = Float64Array.from(s.y);
    this.z = Float64Array.from(s.z);
    s.id.forEach((id, i) => this.index.set(id, i));
    data.regions.forEach((r) => this.regionName.set(r.id, r.name));

    const degree = new Int32Array(this.size);
    for (const i of data.gates) degree[i]! += 1;
    this.gateStart = new Int32Array(this.size + 1);
    for (let i = 0; i < this.size; i++) this.gateStart[i + 1] = this.gateStart[i]! + degree[i]!;
    this.gateList = new Int32Array(data.gates.length);
    const fill = this.gateStart.slice(0, this.size);
    for (let k = 0; k < data.gates.length; k += 2) {
      const a = data.gates[k]!;
      const b = data.gates[k + 1]!;
      this.gateList[fill[a]!++] = b;
      this.gateList[fill[b]!++] = a;
    }

    for (let i = 0; i < this.size; i++) {
      const key = this.cellKey(this.cell(this.x[i]!), this.cell(this.y[i]!), this.cell(this.z[i]!));
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(i);
      else this.grid.set(key, [i]);
    }

    this.ships = data.ships.flatMap((ship) => {
      const hull = hullOfGroup(ship.group);
      return hull ? [{ ...ship, hull }] : [];
    });
  }

  indexOf(solarSystemId: number): number | undefined {
    return this.index.get(solarSystemId);
  }

  id(i: number): number {
    return this.data.systems.id[i]!;
  }

  name(i: number): string {
    return this.data.systems.name[i]!;
  }

  security(i: number): number {
    return this.data.systems.security[i]!;
  }

  regionId(i: number): number {
    return this.data.regions[this.data.systems.region[i]!]!.id;
  }

  regionNameOf(i: number): string {
    return this.data.regions[this.data.systems.region[i]!]!.name;
  }

  hasRegion(regionId: number): boolean {
    return this.regionName.has(regionId);
  }

  flags(i: number): number {
    return this.data.systems.flags[i]!;
  }

  station(i: number): boolean {
    return (this.flags(i) & FLAG_STATION) !== 0;
  }

  pochven(i: number): boolean {
    return (this.flags(i) & FLAG_POCHVEN) !== 0;
  }

  zarzakh(i: number): boolean {
    return (this.flags(i) & FLAG_ZARZAKH) !== 0;
  }

  highSec(i: number): boolean {
    return this.security(i) >= HIGH_SEC_MIN;
  }

  ship(typeId: number): JumpShip | undefined {
    return this.ships.find((s) => s.typeId === typeId);
  }

  distance(i: number, j: number): number {
    const dx = this.x[i]! - this.x[j]!;
    const dy = this.y[i]! - this.y[j]!;
    const dz = this.z[i]! - this.z[j]!;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  gateNeighbours(i: number): Int32Array {
    return this.gateList.subarray(this.gateStart[i]!, this.gateStart[i + 1]!);
  }

  /** Calls `visit` for every other system within `rangeLy` of `i`. */
  within(i: number, rangeLy: number, visit: (j: number, ly: number) => void): void {
    const reach = Math.ceil(rangeLy / CELL);
    const cx = this.cell(this.x[i]!);
    const cy = this.cell(this.y[i]!);
    const cz = this.cell(this.z[i]!);
    for (let a = cx - reach; a <= cx + reach; a++)
      for (let b = cy - reach; b <= cy + reach; b++)
        for (let c = cz - reach; c <= cz + reach; c++) {
          const bucket = this.grid.get(this.cellKey(a, b, c));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const ly = this.distance(i, j);
            if (ly <= rangeLy) visit(j, ly);
          }
        }
  }

  private cell(value: number): number {
    return Math.floor(value / CELL);
  }

  private cellKey(a: number, b: number, c: number): number {
    return ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512);
  }
}
