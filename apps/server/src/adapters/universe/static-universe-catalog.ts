import type { UniverseCatalog, UniverseSystem } from '@wormwright/mapping';
import { loadUniverseData, type UniverseData } from '@wormwright/sde';

/** UniverseCatalog over the dataset built from the SDE, held in memory. */
export class StaticUniverseCatalog implements UniverseCatalog {
  private readonly byId = new Map<number, UniverseSystem>();
  private readonly gates = new Map<number, ReadonlySet<number>>();
  /** Systems with lower-cased names, sorted by name, for search. */
  private readonly byName: Array<{ key: string; system: UniverseSystem }>;

  constructor(data: UniverseData) {
    const regions = new Map(data.regions.map((r) => [r.id, r.name]));
    const constellations = new Map(data.constellations.map((c) => [c.id, c.name]));
    for (const s of data.systems) {
      this.byId.set(s.id, {
        id: s.id,
        name: s.name,
        regionName: regions.get(s.regionId) ?? '',
        constellationName: constellations.get(s.constellationId) ?? '',
        security: s.security,
        whClass: s.whClass,
      });
      this.gates.set(s.id, new Set(s.gates));
    }
    this.byName = [...this.byId.values()]
      .map((system) => ({ key: system.name.toLowerCase(), system }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** The dataset committed in `@wormwright/sde`, parsed once per process. */
  static shared(): StaticUniverseCatalog {
    sharedCatalog ??= new StaticUniverseCatalog(loadUniverseData());
    return sharedCatalog;
  }

  getSystem(solarSystemId: number): UniverseSystem | null {
    return this.byId.get(solarSystemId) ?? null;
  }

  searchSystems(query: string, limit: number): UniverseSystem[] {
    const q = query.trim().toLowerCase();
    if (!q || limit <= 0) return [];
    const prefix: UniverseSystem[] = [];
    const contains: UniverseSystem[] = [];
    for (const { key, system } of this.byName) {
      const at = key.indexOf(q);
      if (at === 0) prefix.push(system);
      else if (at > 0 && contains.length < limit) contains.push(system);
    }
    return [...prefix, ...contains].slice(0, limit);
  }

  gateLinked(a: number, b: number): boolean {
    return this.gates.get(a)?.has(b) ?? false;
  }
}

let sharedCatalog: StaticUniverseCatalog | undefined;
