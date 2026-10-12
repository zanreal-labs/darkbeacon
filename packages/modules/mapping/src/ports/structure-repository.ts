import type { Structure } from '../domain/map.js';

/** Structures in the systems of a map. They go with their map. */
export interface StructureRepository {
  /** In the order they were added. */
  listForSystem(mapId: string, solarSystemId: number): Promise<Structure[]>;
  listForMap(mapId: string): Promise<Structure[]>;
  findById(mapId: string, id: string): Promise<Structure | null>;
  insert(structure: Structure): Promise<void>;
  update(structure: Structure): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
}
