// Test helpers for the mapping adapters and module. Not used at runtime.
import {
  ManualClock,
  type Actor,
  type GrantingMapRole,
  type MapAccess,
  type MapRole,
} from '@wormwright/core';
import type { MapOwnership } from '@wormwright/access';
import type { Database } from '@wormwright/db';
import type { MappingPorts } from '@wormwright/mapping';
import { InProcessEventBus } from '../events/in-process-event-bus.js';
import { KyselyEventLog } from '../events/kysely-event-log.js';
import {
  KyselyConnectionRepository,
  KyselyMapRepository,
  KyselySignatureRepository,
  KyselySystemRepository,
} from './kysely-repositories.js';
import { StaticUniverseCatalog } from '../universe/static-universe-catalog.js';
import { MappingMapOwnership } from './map-ownership.js';

/** A tiny universe. Jita and Perimeter are real and gate-linked; the J-systems are made up. */
export const SYSTEMS = {
  jita: 30000142,
  perimeter: 30000144,
  c2: 31000101,
  c1: 31000102,
  shattered: 31000103,
  c5: 31000104,
} as const;

export function fixtureUniverse(): StaticUniverseCatalog {
  return new StaticUniverseCatalog({
    source: 'fixture',
    regions: [
      { id: 10000002, name: 'The Forge' },
      { id: 11000001, name: 'A-R00001' },
    ],
    constellations: [
      { id: 20000020, name: 'Kimotoro', regionId: 10000002 },
      { id: 21000001, name: 'A-C00001', regionId: 11000001 },
    ],
    systems: [
      {
        id: SYSTEMS.jita,
        name: 'Jita',
        regionId: 10000002,
        constellationId: 20000020,
        security: 0.95,
        whClass: 7,
        gates: [SYSTEMS.perimeter],
      },
      {
        id: SYSTEMS.perimeter,
        name: 'Perimeter',
        regionId: 10000002,
        constellationId: 20000020,
        security: 0.95,
        whClass: 7,
        gates: [SYSTEMS.jita],
      },
      {
        id: SYSTEMS.c2,
        name: 'J100101',
        regionId: 11000001,
        constellationId: 21000001,
        security: -0.99,
        whClass: 2,
        gates: [],
      },
      {
        id: SYSTEMS.c1,
        name: 'J100102',
        regionId: 11000001,
        constellationId: 21000001,
        security: -0.99,
        whClass: 1,
        gates: [],
      },
      {
        id: SYSTEMS.shattered,
        name: 'J100103',
        regionId: 11000001,
        constellationId: 21000001,
        security: -0.99,
        whClass: 13,
        gates: [],
      },
      {
        id: SYSTEMS.c5,
        name: 'J100104',
        regionId: 11000001,
        constellationId: 21000001,
        security: -0.99,
        whClass: 5,
        gates: [],
      },
    ],
  });
}

/** MapAccess where the owner is admin of their maps, plus explicit grants. */
export class FakeMapAccess implements MapAccess {
  private readonly grants = new Map<string, Map<string, MapRole>>();

  constructor(private readonly ownership: MapOwnership) {}

  grant(actorId: string, mapId: string, role: MapRole): void {
    if (!this.grants.has(actorId)) this.grants.set(actorId, new Map());
    this.grants.get(actorId)!.set(mapId, role);
  }

  async roleOf(actor: Actor, mapId: string): Promise<MapRole | null> {
    if (actor.kind === 'account' && (await this.ownership.ownerOf(mapId)) === actor.id) return 'admin';
    return this.grants.get(actor.id)?.get(mapId) ?? null;
  }

  async mapsFor(actor: Actor): Promise<Array<{ mapId: string; role: GrantingMapRole }>> {
    const result: Array<{ mapId: string; role: GrantingMapRole }> =
      actor.kind === 'account'
        ? (await this.ownership.mapsOwnedBy(actor.id)).map((mapId) => ({ mapId, role: 'admin' }))
        : [];
    for (const [mapId, role] of this.grants.get(actor.id) ?? []) {
      if (role !== 'blocked') result.push({ mapId, role });
    }
    return result;
  }
}

export function account(id: string): Actor {
  return { kind: 'account', id, instanceRole: 'user' };
}

/** Real repositories and event log on `database`, fake access, fixture universe, manual clock. */
export function mappingTestPorts(database: Database) {
  const bus = new InProcessEventBus();
  const maps = new KyselyMapRepository(database);
  const access = new FakeMapAccess(new MappingMapOwnership(maps));
  const clock = new ManualClock();
  const ports: MappingPorts = {
    maps,
    systems: new KyselySystemRepository(database),
    connections: new KyselyConnectionRepository(database),
    signatures: new KyselySignatureRepository(database),
    universe: fixtureUniverse(),
    access,
    events: new KyselyEventLog(database, bus),
    uow: database,
    clock,
  };
  return { ports, access, clock, bus };
}
