import type { MapOwnership } from '@wormwright/access';
import type { MapRepository } from '@wormwright/mapping';

/** The access module's MapOwnership port, answered from mapping's map repository. */
export class MappingMapOwnership implements MapOwnership {
  constructor(private readonly maps: MapRepository) {}

  async ownerOf(mapId: string): Promise<string | null> {
    return (await this.maps.findById(mapId))?.ownerAccountId ?? null;
  }

  async mapsOwnedBy(accountId: string): Promise<string[]> {
    return (await this.maps.listOwnedBy(accountId)).map((m) => m.id);
  }
}
