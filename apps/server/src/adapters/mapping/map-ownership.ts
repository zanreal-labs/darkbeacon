import type { MapOwnership } from '@wormwright/access';
import type { Actor, GrantingMapRole, MapAccess, MapRole } from '@wormwright/core';
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

/**
 * Stand-in for the access module's MapAccess when none is installed: the owner is admin of
 * their maps and nobody else sees them.
 */
export class OwnerOnlyMapAccess implements MapAccess {
  constructor(private readonly ownership: MapOwnership) {}

  async roleOf(actor: Actor, mapId: string): Promise<MapRole | null> {
    if (actor.kind !== 'account') return null;
    return (await this.ownership.ownerOf(mapId)) === actor.id ? 'admin' : null;
  }

  async mapsFor(actor: Actor): Promise<Array<{ mapId: string; role: GrantingMapRole }>> {
    if (actor.kind !== 'account') return [];
    return (await this.ownership.mapsOwnedBy(actor.id)).map((mapId) => ({ mapId, role: 'admin' }));
  }
}
