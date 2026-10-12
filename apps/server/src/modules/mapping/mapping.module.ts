import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { Clock, EventLog, MapAccess, UnitOfWork } from '@wormwright/core';
import { Database } from '@wormwright/db';
import {
  ConnectionUseCases,
  MapSnapshotQuery,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type MapRepository,
  type MappingPorts,
  type UniverseCatalog,
} from '@wormwright/mapping';
import {
  KyselyConnectionRepository,
  KyselyMapRepository,
  KyselySignatureRepository,
  KyselySystemRepository,
} from '../../adapters/mapping/kysely-repositories.js';
import { MappingMapOwnership } from '../../adapters/mapping/map-ownership.js';
import { CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK, UNIVERSE_CATALOG } from '../../platform/tokens.js';
import { MapOwnershipRegistry } from '../access/map-ownership.registry.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import {
  ConnectionsController,
  MapsController,
  SignaturesController,
  SystemsController,
} from './mapping.controllers.js';
import { MAP_OWNERSHIP, MAP_REPOSITORY, MAPPING_PORTS } from './mapping.tokens.js';

const useCase = <T>(type: new (ports: MappingPorts) => T) => ({
  provide: type,
  useFactory: (ports: MappingPorts) => new type(ports),
  inject: [MAPPING_PORTS],
});

/**
 * Maps, systems, connections, signatures and labels: REST under /api/maps and the mapping part
 * of the `map:<id>` snapshot.
 */
@Module({
  controllers: [MapsController, SystemsController, ConnectionsController, SignaturesController],
  providers: [
    {
      provide: MAP_REPOSITORY,
      useFactory: (db: Database) => new KyselyMapRepository(db),
      inject: [Database],
    },
    {
      provide: MAP_OWNERSHIP,
      useFactory: (maps: MapRepository) => new MappingMapOwnership(maps),
      inject: [MAP_REPOSITORY],
    },
    {
      provide: MAPPING_PORTS,
      useFactory: (
        database: Database,
        maps: MapRepository,
        universe: UniverseCatalog,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
        access: MapAccess,
      ): MappingPorts => ({
        maps,
        systems: new KyselySystemRepository(database),
        connections: new KyselyConnectionRepository(database),
        signatures: new KyselySignatureRepository(database),
        universe,
        access,
        events,
        uow,
        clock,
      }),
      inject: [Database, MAP_REPOSITORY, UNIVERSE_CATALOG, EVENT_LOG, UNIT_OF_WORK, CLOCK, MAP_ACCESS],
    },
    useCase(MapUseCases),
    useCase(SystemUseCases),
    useCase(ConnectionUseCases),
    useCase(SignatureUseCases),
    useCase(MapSnapshotQuery),
  ],
  exports: [
    MAP_REPOSITORY,
    MAP_OWNERSHIP,
    MAPPING_PORTS,
    MapUseCases,
    SystemUseCases,
    ConnectionUseCases,
    SignatureUseCases,
  ],
})
export class MappingModule implements OnModuleInit {
  constructor(
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(MapSnapshotQuery) private readonly snapshots: MapSnapshotQuery,
    @Inject(MapOwnershipRegistry) private readonly ownershipRegistry: MapOwnershipRegistry,
    @Inject(MAP_OWNERSHIP) private readonly ownership: MappingMapOwnership,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', (mapId, actor) => this.snapshots.snapshot(actor, mapId));
    // Access answers map roles from map ownership; it cannot inject mapping directly (DI cycle).
    this.ownershipRegistry.use(this.ownership);
  }
}
