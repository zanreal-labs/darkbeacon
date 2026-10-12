import type { ChainMap } from '../domain/map.js';

export interface MapRepository {
  /** The map, deleted (restorable) ones included: callers check `deletedAt`. */
  findById(id: string): Promise<ChainMap | null>;
  findBySlug(slug: string): Promise<ChainMap | null>;
  listByIds(ids: readonly string[]): Promise<ChainMap[]>;
  /** Maps the account owns that are not deleted. */
  listOwnedBy(accountId: string): Promise<ChainMap[]>;
  /** Ids of every map that is not deleted, oldest first. */
  allIds(): Promise<string[]>;
  /** Every map, deleted ones included (the admins' inventory), oldest first. */
  listAll(): Promise<ChainMap[]>;
  insert(map: ChainMap): Promise<void>;
  update(map: ChainMap): Promise<void>;
  /** Deletes the map and everything on it (systems, connections, signatures). */
  delete(id: string): Promise<void>;
}
