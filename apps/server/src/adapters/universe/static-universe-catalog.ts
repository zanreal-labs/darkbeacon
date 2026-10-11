import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UniverseCatalog, UniverseSystem } from '@wormwright/mapping';
import { loadUniverseData, UNIVERSE_DATA_FILE, type UniverseData } from '@wormwright/sde';

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

  /**
   * `universe.json` from the data directory when an operator put one there, else the dataset
   * committed in `@wormwright/sde`. Each file is parsed once per process.
   */
  static load(dataDir: string): StaticUniverseCatalog {
    const custom = join(dataDir, 'universe.json');
    const file = existsSync(custom) ? custom : UNIVERSE_DATA_FILE;
    let catalog = loaded.get(file);
    if (!catalog) {
      catalog = new StaticUniverseCatalog(loadUniverseData(file));
      // Only the committed dataset is cached; a custom file may change between test apps.
      if (file === UNIVERSE_DATA_FILE) loaded.set(file, catalog);
    }
    return catalog;
  }

  get size(): number {
    return this.byId.size;
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

const loaded = new Map<string, StaticUniverseCatalog>();
