import type { ChainMap } from '../domain/map.js';

export interface MapRepository {
  findById(id: string): Promise<ChainMap | null>;
  findBySlug(slug: string): Promise<ChainMap | null>;
  listByIds(ids: readonly string[]): Promise<ChainMap[]>;
  listOwnedBy(accountId: string): Promise<ChainMap[]>;
  insert(map: ChainMap): Promise<void>;
  update(map: ChainMap): Promise<void>;
  delete(id: string): Promise<void>;
}
