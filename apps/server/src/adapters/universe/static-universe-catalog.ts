import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UniverseCatalog, UniverseSystem } from '@darkbeacon/mapping';
import { WormholeEffect } from '@darkbeacon/shared';
import {
  loadUniverseData,
  loadWormholeData,
  UNIVERSE_DATA_FILE,
  WORMHOLE_DATA_FILE,
  type UniverseData,
  type WormholeData,
} from '@darkbeacon/sde';

/** UniverseCatalog over the dataset built from the SDE, held in memory. */
export class StaticUniverseCatalog implements UniverseCatalog {
  private readonly byId = new Map<number, UniverseSystem>();
  private readonly gates = new Map<number, ReadonlySet<number>>();
  /** Systems with lower-cased names, sorted by name, for search. */
  private readonly byName: Array<{ key: string; system: UniverseSystem }>;

  constructor(data: UniverseData, wormholes: WormholeData = { source: 'none', systems: {} }) {
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
        ...wormholeFacts(wormholes.systems[s.id]),
      });
      this.gates.set(s.id, new Set(s.gates));
    }
    this.byName = [...this.byId.values()]
      .map((system) => ({ key: system.name.toLowerCase(), system }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /**
   * `universe.json` and `wormholes.json` from the data directory when an operator put them there,
   * else the datasets committed in `@darkbeacon/sde`. The committed pair is parsed once per process.
   */
  static load(dataDir: string): StaticUniverseCatalog {
    const pick = (name: string, committed: string) => {
      const custom = join(dataDir, name);
      return existsSync(custom) ? custom : committed;
    };
    const file = pick('universe.json', UNIVERSE_DATA_FILE);
    const wormholeFile = pick('wormholes.json', WORMHOLE_DATA_FILE);
    const committed = file === UNIVERSE_DATA_FILE && wormholeFile === WORMHOLE_DATA_FILE;
    // Only the committed datasets are cached; custom files may change between test apps.
    const cached = committed ? loaded : undefined;
    if (cached) return cached;
    const catalog = new StaticUniverseCatalog(loadUniverseData(file), loadWormholeData(wormholeFile));
    if (committed) loaded = catalog;
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

let loaded: StaticUniverseCatalog | undefined;

/** Statics (upper-cased) and a known effect of one system; anything else in the file is ignored. */
function wormholeFacts(
  entry: WormholeData['systems'][string] | undefined,
): Pick<UniverseSystem, 'statics' | 'effect'> {
  const effect = WormholeEffect.safeParse(entry?.effect);
  return {
    statics: (entry?.statics ?? []).map((type) => type.trim().toUpperCase()).filter(Boolean),
    effect: effect.success ? effect.data : null,
  };
}
