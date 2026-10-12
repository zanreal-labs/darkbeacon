import type { ChainMap } from '../domain/map.js';

export interface MapRepository {
  findById(id: string): Promise<ChainMap | null>;
  findBySlug(slug: string): Promise<ChainMap | null>;
  listByIds(ids: readonly string[]): Promise<ChainMap[]>;
  listOwnedBy(accountId: string): Promise<ChainMap[]>;
  /** Ids of every map, oldest first. */
  allIds(): Promise<string[]>;
  insert(map: ChainMap): Promise<void>;
  update(map: ChainMap): Promise<void>;
  /** Deletes the map and everything on it (systems, connections, signatures). */
  delete(id: string): Promise<void>;
}
