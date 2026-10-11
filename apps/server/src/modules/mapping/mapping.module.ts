import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { hasMapRole, type Clock, type EventLog, type MapAccess, type UnitOfWork } from '@wormwright/core';
import { Database } from '@wormwright/db';
import {
  ConnectionUseCases,
  MapSnapshotQuery,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  UniverseQueries,
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
import { MappingMapOwnership, OwnerOnlyMapAccess } from '../../adapters/mapping/map-ownership.js';
import { loadUniverseCatalog } from '../../adapters/mapping/universe-catalog.js';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import {
  ConnectionsController,
  MapsController,
  SignaturesController,
  SystemsController,
  UniverseController,
} from './mapping.controllers.js';
import { MAP_OWNERSHIP, MAP_REPOSITORY, MAPPING_PORTS, UNIVERSE_CATALOG } from './mapping.tokens.js';

const logger = new Logger('Mapping');

const useCase = <T>(type: new (ports: MappingPorts) => T) => ({
  provide: type,
  useFactory: (ports: MappingPorts) => new type(ports),
  inject: [MAPPING_PORTS],
});

/**
 * Maps, systems, connections, signatures and labels: REST under /api/maps, the universe
 * lookups, and the mapping part of the `map:<id>` snapshot.
 */
@Module({
  controllers: [
    MapsController,
    SystemsController,
    ConnectionsController,
    SignaturesController,
    UniverseController,
  ],
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
      provide: UNIVERSE_CATALOG,
      useFactory: (config: AppConfig) => {
        const catalog = loadUniverseCatalog(config.dataDir, (m) => logger.warn(m));
        logger.log(`universe catalog: ${catalog.size} systems`);
        return catalog;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: MAPPING_PORTS,
      useFactory: (
        database: Database,
        maps: MapRepository,
        ownership: MappingMapOwnership,
        universe: UniverseCatalog,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
        access: MapAccess | undefined,
      ): MappingPorts => ({
        maps,
        systems: new KyselySystemRepository(database),
        connections: new KyselyConnectionRepository(database),
        signatures: new KyselySignatureRepository(database),
        universe,
        // Until the access module provides MAP_ACCESS, owners are the only members of their maps.
        access: access ?? new OwnerOnlyMapAccess(ownership),
        events,
        uow,
        clock,
      }),
      inject: [
        Database,
        MAP_REPOSITORY,
        MAP_OWNERSHIP,
        UNIVERSE_CATALOG,
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
        { token: MAP_ACCESS, optional: true },
      ],
    },
    useCase(MapUseCases),
    useCase(SystemUseCases),
    useCase(ConnectionUseCases),
    useCase(SignatureUseCases),
    useCase(MapSnapshotQuery),
    {
      provide: UniverseQueries,
      useFactory: (universe: UniverseCatalog) => new UniverseQueries(universe),
      inject: [UNIVERSE_CATALOG],
    },
  ],
  exports: [MAP_REPOSITORY, MAP_OWNERSHIP, UNIVERSE_CATALOG, MAPPING_PORTS],
})
export class MappingModule implements OnModuleInit {
  constructor(
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(MapSnapshotQuery) private readonly snapshots: MapSnapshotQuery,
    @Inject(MAPPING_PORTS) private readonly ports: MappingPorts,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', (mapId, actor) => this.snapshots.snapshot(actor, mapId));
    // The access module owns `map` stream authorization; this only covers a server without it.
    if (!this.registry.stream('map')) {
      const { access } = this.ports;
      this.registry.registerStream('map', {
        authorize: async (actor, mapId) => !!actor && hasMapRole(await access.roleOf(actor, mapId), 'viewer'),
      });
    }
  }
}
