import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UniverseCatalog, UniverseSystem } from '@wormwright/mapping';

/** The parts of `@wormwright/sde`'s `universe.json` the catalog reads. */
export interface UniverseFile {
  regions: Array<{ id: number; name: string }>;
  constellations: Array<{ id: number; name: string; regionId: number }>;
  systems: Array<{
    id: number;
    name: string;
    regionId: number;
    constellationId: number;
    security: number;
    whClass: number | null;
    gates: number[];
  }>;
}

/** Static universe data held in memory; lookups are synchronous. */
export class InMemoryUniverseCatalog implements UniverseCatalog {
  private readonly systems = new Map<number, UniverseSystem>();
  private readonly gates = new Map<number, ReadonlySet<number>>();
  /** Systems with lower-cased names, sorted by name, for search. */
  private readonly byName: Array<{ key: string; system: UniverseSystem }>;

  constructor(data: UniverseFile) {
    const regions = new Map(data.regions.map((r) => [r.id, r.name]));
    const constellations = new Map(data.constellations.map((c) => [c.id, c.name]));
    for (const s of data.systems) {
      this.systems.set(s.id, {
        id: s.id,
        name: s.name,
        regionName: regions.get(s.regionId) ?? '',
        constellationName: constellations.get(s.constellationId) ?? '',
        security: s.security,
        whClass: s.whClass,
      });
      this.gates.set(s.id, new Set(s.gates));
    }
    this.byName = [...this.systems.values()]
      .map((system) => ({ key: system.name.toLowerCase(), system }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  get size(): number {
    return this.systems.size;
  }

  getSystem(solarSystemId: number): UniverseSystem | null {
    return this.systems.get(solarSystemId) ?? null;
  }

  searchSystems(query: string, limit: number): UniverseSystem[] {
    const q = query.trim().toLowerCase();
    if (!q || limit <= 0) return [];
    const prefix = this.byName.filter((e) => e.key.startsWith(q));
    const rest = this.byName.filter((e) => !e.key.startsWith(q) && e.key.includes(q));
    return [...prefix, ...rest].slice(0, limit).map((e) => e.system);
  }

  gateLinked(a: number, b: number): boolean {
    return this.gates.get(a)?.has(b) ?? false;
  }
}

/**
 * Loads `universe.json` from the data directory, or from the copy built into `packages/sde`.
 * Without either the catalog is empty and no system can be added; the log says so.
 */
export function loadUniverseCatalog(
  dataDir: string,
  warn: (message: string) => void,
): InMemoryUniverseCatalog {
  const candidates = [
    join(dataDir, 'universe.json'),
    new URL('../../../../../packages/sde/data/universe.json', import.meta.url).pathname,
  ];
  const file = candidates.find((path) => existsSync(path));
  if (!file) {
    warn(`no universe.json found (looked in ${candidates.join(', ')}); systems cannot be added`);
    return new InMemoryUniverseCatalog({ regions: [], constellations: [], systems: [] });
  }
  return new InMemoryUniverseCatalog(JSON.parse(readFileSync(file, 'utf8')) as UniverseFile);
}
