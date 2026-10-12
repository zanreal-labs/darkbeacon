import { Injectable } from '@nestjs/common';
import type { MapOwnership } from '@darkbeacon/access';

/**
 * Where the access module learns who owns a map. The mapping module installs its adapter with
 * `registry.use(...)` in `onModuleInit` (it cannot be a constructor dependency: mapping itself
 * depends on MAP_ACCESS). Until then no map exists as far as access is concerned.
 */
@Injectable()
export class MapOwnershipRegistry implements MapOwnership {
  private ownership: MapOwnership = {
    ownerOf: () => Promise.resolve(null),
    mapsOwnedBy: () => Promise.resolve([]),
  };

  use(ownership: MapOwnership): void {
    this.ownership = ownership;
  }

  ownerOf(mapId: string): Promise<string | null> {
    return this.ownership.ownerOf(mapId);
  }

  mapsOwnedBy(accountId: string): Promise<string[]> {
    return this.ownership.mapsOwnedBy(accountId);
  }
}
