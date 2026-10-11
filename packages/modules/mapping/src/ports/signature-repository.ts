import type { Signature } from '../domain/map.js';

export interface SignatureRepository {
  listForMap(mapId: string): Promise<Signature[]>;
  listForSystem(mapId: string, solarSystemId: number): Promise<Signature[]>;
  findById(mapId: string, id: string): Promise<Signature | null>;
  insert(signature: Signature): Promise<void>;
  update(signature: Signature): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
}
