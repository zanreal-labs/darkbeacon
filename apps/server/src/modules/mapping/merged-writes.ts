import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ChainMerger, ChainWrites } from '@darkbeacon/sharing';

/**
 * One API for every map: on a map that merges others, the map routes for systems, connections
 * and signatures change the merged chain (sharing's writes, through to the sources) instead of
 * the map's own rows. Sharing is built on mapping, so it is looked up when a request comes in.
 */
@Injectable()
export class MergedWriteRouter {
  constructor(@Inject(ModuleRef) private readonly modules: ModuleRef) {}

  async route<T>(mapId: string, merged: (writes: ChainWrites) => Promise<unknown>, plain: () => Promise<T>) {
    const sharing = this.sharing();
    if (sharing && (await sharing.merger.isMerged(mapId)))
      return (await merged(sharing.writes)) as T | undefined;
    return plain();
  }

  private sharing(): { merger: ChainMerger; writes: ChainWrites } | null {
    try {
      return {
        merger: this.modules.get(ChainMerger, { strict: false }),
        writes: this.modules.get(ChainWrites, { strict: false }),
      };
    } catch {
      return null;
    }
  }
}
