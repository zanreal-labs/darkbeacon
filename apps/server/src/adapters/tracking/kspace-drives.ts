import type { DriveLookup } from '@darkbeacon/tracking';
import { loadKspaceSource } from '../jumps/kspace-source.js';

/**
 * Jump drives as the k-space dataset (`kspace.json`, built from the SDE) knows them: every ship
 * type with a jump drive range, and the position of every known-space system in light years.
 */
export class KspaceDrives implements DriveLookup {
  private readonly ships: ReadonlySet<number>;
  private readonly at = new Map<number, readonly [number, number, number]>();

  constructor(dataDir: string) {
    const { data } = loadKspaceSource(dataDir);
    this.ships = new Set(data.ships.map((s) => s.typeId));
    const s = data.systems;
    s.id.forEach((id, i) => this.at.set(id, [s.x[i]!, s.y[i]!, s.z[i]!]));
  }

  jumpDriveShip(shipTypeId: number): boolean {
    return this.ships.has(shipTypeId);
  }

  distanceLy(a: number, b: number): number | null {
    const p = this.at.get(a);
    const q = this.at.get(b);
    if (!p || !q) return null;
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
}
