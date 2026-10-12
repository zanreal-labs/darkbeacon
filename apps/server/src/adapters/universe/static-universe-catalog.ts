import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FitItem, UniverseCatalog, UniverseSystem } from '@darkbeacon/mapping';
import {
  destinationOfClass,
  HULL_CLASS_LABEL,
  shipSizeForJumpMass,
  WORMHOLE_TYPES,
  WormholeEffect,
  type HullClassDto,
  type MassModifiersDto,
  type ShipTypeDto,
  type WormholeTypeDto,
} from '@darkbeacon/shared';
import {
  loadUniverseData,
  loadWormholeData,
  UNIVERSE_DATA_FILE,
  WORMHOLE_DATA_FILE,
  type UniverseData,
  type WormholeData,
  type WormholeTypeData,
} from '@darkbeacon/sde';

/** UniverseCatalog over the dataset built from the SDE, held in memory. */
export class StaticUniverseCatalog implements UniverseCatalog {
  private readonly byId = new Map<number, UniverseSystem>();
  private readonly gates = new Map<number, readonly number[]>();
  /** Systems with lower-cased names, sorted by name, for search. */
  private readonly byName: Array<{ key: string; system: UniverseSystem }>;
  private readonly types = new Map<string, WormholeTypeDto>();
  private readonly hulls: HullClassDto[];
  private readonly masses: ReadonlyMap<number, number>;
  private readonly ships = new Map<number, ShipTypeDto>();
  /** Ships with lower-cased names, sorted by name, for search. */
  private readonly shipsByName: Array<{ key: string; ship: ShipTypeDto }>;
  private readonly modifiers: MassModifiersDto;
  private readonly shipNames = new Map<string, ShipTypeDto>();
  private readonly fitItems = new Map<string, FitItem>();

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
      this.gates.set(s.id, s.gates);
    }
    this.byName = [...this.byId.values()]
      .map((system) => ({ key: system.name.toLowerCase(), system }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    this.hulls = (wormholes.hullClasses ?? [])
      .map((h) => ({ id: h.id, name: HULL_CLASS_LABEL[h.id], maxMass: h.maxMass }))
      .sort((a, b) => a.maxMass - b.maxMass);
    for (const type of wormholes.types ?? []) this.types.set(type.code, this.typeDto(type));
    this.masses = new Map(Object.entries(wormholes.shipMasses ?? {}).map(([id, mass]) => [Number(id), mass]));
    this.modifiers = wormholes.massModifiers ?? {
      prop: { small: 0, medium: 0, large: 0, capital: 0 },
      higgsPercent: 0,
      entanglerPercent: 0,
    };
    for (const ship of wormholes.ships ?? []) {
      const mass = this.masses.get(ship.id);
      if (!mass) continue;
      this.ships.set(ship.id, {
        id: ship.id,
        name: ship.name,
        group: ship.group,
        hullClass: ship.hull,
        mass,
        propSize: ship.propSize,
        propMass: ship.propSize ? (this.modifiers.prop[ship.propSize] ?? null) : null,
        higgs: ship.rigs,
        entangler: ship.entangler,
      });
    }
    for (const ship of this.ships.values()) this.shipNames.set(ship.name.toLowerCase(), ship);
    for (const item of wormholes.fitItems ?? []) this.fitItems.set(item.name.toLowerCase(), item);
    this.shipsByName = [...this.ships.values()]
      .map((ship) => ({ key: ship.name.toLowerCase(), ship }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /**
   * `universe.json` and `wormholes.json` from the data directory when an operator put them there,
   * else the datasets committed in `@darkbeacon/sde`. The committed pair is parsed once per process.
   * A custom `wormholes.json` without types, hull classes, ship masses, ships or mass modifiers
   * takes them from the committed one.
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
    let wormholes = loadWormholeData(wormholeFile);
    if (
      wormholeFile !== WORMHOLE_DATA_FILE &&
      !(
        wormholes.types &&
        wormholes.hullClasses &&
        wormholes.shipMasses &&
        wormholes.ships &&
        wormholes.massModifiers &&
        wormholes.fitItems
      )
    ) {
      const base = loadWormholeData(WORMHOLE_DATA_FILE);
      wormholes = {
        ...wormholes,
        types: wormholes.types ?? base.types,
        hullClasses: wormholes.hullClasses ?? base.hullClasses,
        shipMasses: wormholes.shipMasses ?? base.shipMasses,
        ships: wormholes.ships ?? base.ships,
        massModifiers: wormholes.massModifiers ?? base.massModifiers,
        fitItems: wormholes.fitItems ?? base.fitItems,
      };
    }
    const catalog = new StaticUniverseCatalog(loadUniverseData(file), wormholes);
    if (committed) loaded = catalog;
    return catalog;
  }

  get size(): number {
    return this.byId.size;
  }

  getSystem(solarSystemId: number): UniverseSystem | null {
    return this.byId.get(solarSystemId) ?? null;
  }

  /** Every system, in id order. */
  systems(): IterableIterator<UniverseSystem> {
    return this.byId.values();
  }

  /** Stargate neighbours of a system. */
  gateNeighbours(solarSystemId: number): readonly number[] {
    return this.gates.get(solarSystemId) ?? [];
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
    return this.gates.get(a)?.includes(b) ?? false;
  }

  wormholeType(code: string): WormholeTypeDto | null {
    return this.types.get(code.trim().toUpperCase()) ?? null;
  }

  wormholeTypes(): WormholeTypeDto[] {
    return [...this.types.values()];
  }

  hullClasses(): HullClassDto[] {
    return this.hulls;
  }

  shipMass(shipTypeId: number): number | null {
    return this.masses.get(shipTypeId) ?? null;
  }

  ship(shipTypeId: number): ShipTypeDto | null {
    return this.ships.get(shipTypeId) ?? null;
  }

  searchShips(query: string, limit: number): ShipTypeDto[] {
    const q = query.trim().toLowerCase();
    if (!q || limit <= 0) return [];
    const prefix: ShipTypeDto[] = [];
    const contains: ShipTypeDto[] = [];
    for (const { key, ship } of this.shipsByName) {
      const at = key.indexOf(q);
      if (at === 0) prefix.push(ship);
      else if (at > 0 && contains.length < limit) contains.push(ship);
    }
    return [...prefix, ...contains].slice(0, limit);
  }

  massModifiers(): MassModifiersDto {
    return this.modifiers;
  }

  shipByName(name: string): ShipTypeDto | null {
    return this.shipNames.get(name.trim().toLowerCase()) ?? null;
  }

  fitItem(name: string): FitItem | null {
    return this.fitItems.get(name.trim().toLowerCase()) ?? null;
  }

  private typeDto(type: WormholeTypeData): WormholeTypeDto {
    const maxJumpMass = positive(type.maxJumpMass);
    return {
      code: type.code,
      // Region-bound types (-1) lead where the game data on the EVE University wiki says.
      destination: destinationOfClass(type.targetClass) ?? WORMHOLE_TYPES[type.code] ?? null,
      targetClass: type.targetClass,
      lifetimeHours: type.maxStableTimeMinutes ? type.maxStableTimeMinutes / 60 : null,
      totalMass: positive(type.maxStableMass),
      maxJumpMass,
      massRegeneration: type.massRegeneration,
      fits: maxJumpMass === null ? [] : this.hulls.filter((h) => h.maxMass <= maxJumpMass).map((h) => h.id),
      shipSize: shipSizeForJumpMass(maxJumpMass),
    };
  }
}

let loaded: StaticUniverseCatalog | undefined;

const positive = (value: number | null) => (value !== null && value > 0 ? value : null);

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
