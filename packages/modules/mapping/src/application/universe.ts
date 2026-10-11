import { NotFoundError, requireActor, type Actor } from '@wormwright/core';
import type { UniverseCatalog, UniverseSystem } from '../ports/index.js';

/** Static game data lookups, open to any signed-in caller. */
export class UniverseQueries {
  constructor(private readonly universe: UniverseCatalog) {}

  search(actor: Actor | null, query: string, limit: number): UniverseSystem[] {
    requireActor(actor);
    return this.universe.searchSystems(query, limit);
  }

  get(actor: Actor | null, solarSystemId: number): UniverseSystem {
    requireActor(actor);
    const system = this.universe.getSystem(solarSystemId);
    if (!system) throw new NotFoundError('Solar system');
    return system;
  }
}
