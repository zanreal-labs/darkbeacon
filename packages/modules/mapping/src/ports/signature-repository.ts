import type { Signature } from '../domain/map.js';

export interface SignatureRepository {
  listForMap(mapId: string): Promise<Signature[]>;
  listForSystem(mapId: string, solarSystemId: number): Promise<Signature[]>;
  findById(mapId: string, id: string): Promise<Signature | null>;
  /**
   * `restoredAt`: the signature is put back after a removal (an undo); its fields count as written
   * then, so maps merging this one take it over their tombstone.
   */
  insert(signature: Signature, options?: { restoredAt?: number }): Promise<void>;
  update(signature: Signature): Promise<void>;
  /** Moves `updatedAt` forward without changing anything else (seen again in a scan). */
  touch(mapId: string, ids: readonly string[], at: number): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
  /** Signatures not changed since before `before` (epoch ms), of every map. */
  listUpdatedBefore(before: number): Promise<Signature[]>;
}
