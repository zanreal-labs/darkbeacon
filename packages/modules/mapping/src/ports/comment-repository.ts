import type { Comment } from '../domain/map.js';

/** Comments on the systems of a map. They go with their map. */
export interface CommentRepository {
  /** Newest first. */
  listForSystem(mapId: string, solarSystemId: number): Promise<Comment[]>;
  /** Every comment of the map, oldest first (map files). */
  listForMap(mapId: string): Promise<Comment[]>;
  /** How many comments each system has (systems without any are left out). */
  countsForMap(mapId: string): Promise<Map<number, number>>;
  findById(mapId: string, id: string): Promise<Comment | null>;
  insert(comment: Comment): Promise<void>;
  delete(mapId: string, id: string): Promise<void>;
}
