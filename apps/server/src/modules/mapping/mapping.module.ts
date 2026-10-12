import { Inject, Logger, Module, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import {
  parseStream,
  type Clock,
  type DomainEvent,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  ChainOverlaySlot,
  BookmarkNumberUseCases,
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapPreferenceUseCases,
  MapSnapshotQuery,
  PassageRecorder,
  PassageUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type MapRepository,
  type MappingPorts,
  type UniverseCatalog,
} from '@darkbeacon/mapping';
import {
  KyselyChangeStamps,
  KyselyConnectionRepository,
  KyselyMapRepository,
  KyselyPassageRepository,
  KyselySignatureRepository,
  KyselySystemRepository,
} from '../../adapters/mapping/kysely-repositories.js';
import { KyselyMapPreferenceRepository } from '../../adapters/mapping/kysely-preferences.js';
import { KyselyPilotDirectory } from '../../adapters/mapping/pilot-directory.js';
import { MappingMapOwnership } from '../../adapters/mapping/map-ownership.js';
import { isEventOfType } from '@darkbeacon/shared';
import { AsyncAuditScope } from '../../platform/audit.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { CLOCK, EVENT_LOG, MAP_ACCESS, UNIT_OF_WORK, UNIVERSE_CATALOG } from '../../platform/tokens.js';
import { MapOwnershipRegistry } from '../access/map-ownership.registry.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import {
  BookmarkNumbersController,
  ConnectionsController,
  MapPreferencesController,
  MapsController,
  SignaturesController,
  SystemsController,
} from './mapping.controllers.js';
import { MergedWriteRouter } from './merged-writes.js';
import { SweeperRuntime } from './sweeper.runtime.js';
import { CHAIN_OVERLAY, MAP_OWNERSHIP, MAP_REPOSITORY, MAPPING_PORTS } from './mapping.tokens.js';

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
  controllers: [
    MapsController,
    MapPreferencesController,
    SystemsController,
    ConnectionsController,
    BookmarkNumbersController,
    SignaturesController,
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
    { provide: CHAIN_OVERLAY, useFactory: () => new ChainOverlaySlot() },
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
        overlay: ChainOverlaySlot,
      ): MappingPorts => ({
        maps,
        systems: new KyselySystemRepository(database),
        connections: new KyselyConnectionRepository(database),
        signatures: new KyselySignatureRepository(database),
        passages: new KyselyPassageRepository(database),
        pilots: new KyselyPilotDirectory(database),
        stamps: new KyselyChangeStamps(database),
        overlay,
        universe,
        access,
        events,
        uow,
        clock,
      }),
      inject: [
        Database,
        MAP_REPOSITORY,
        UNIVERSE_CATALOG,
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
        MAP_ACCESS,
        CHAIN_OVERLAY,
      ],
    },
    MergedWriteRouter,
    SweeperRuntime,
    useCase(MapUseCases),
    useCase(SystemUseCases),
    useCase(ConnectionUseCases),
    useCase(SignatureUseCases),
    useCase(BookmarkNumberUseCases),
    useCase(MapSnapshotQuery),
    useCase(ConnectionIntelQuery),
    useCase(PassageRecorder),
    useCase(PassageUseCases),
    {
      provide: MapPreferenceUseCases,
      useFactory: (database: Database, access: MapAccess, clock: Clock) =>
        new MapPreferenceUseCases({
          preferences: new KyselyMapPreferenceRepository(database),
          access,
          clock,
        }),
      inject: [Database, MAP_ACCESS, CLOCK],
    },
  ],
  exports: [
    CHAIN_OVERLAY,
    MAP_REPOSITORY,
    MAP_OWNERSHIP,
    MAPPING_PORTS,
    MapUseCases,
    SystemUseCases,
    ConnectionUseCases,
    SignatureUseCases,
    BookmarkNumberUseCases,
    PassageUseCases,
    SweeperRuntime,
  ],
})
export class MappingModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('Mapping');

  constructor(
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(MapSnapshotQuery) private readonly snapshots: MapSnapshotQuery,
    @Inject(MapOwnershipRegistry) private readonly ownershipRegistry: MapOwnershipRegistry,
    @Inject(MAP_OWNERSHIP) private readonly ownership: MappingMapOwnership,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(PassageRecorder) private readonly passages: PassageRecorder,
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(BookmarkNumberUseCases) private readonly numbers: BookmarkNumberUseCases,
    @Inject(AsyncAuditScope) private readonly audit: AsyncAuditScope,
  ) {}

  /** Wormholes mapped before bookmark numbers existed get theirs once, as the server. */
  async onApplicationBootstrap(): Promise<void> {
    const maps = await this.audit.run(
      { channel: { kind: 'system', id: 'bookmark-numbers' }, origin: undefined },
      () => this.numbers.backfill(),
    );
    if (maps.length > 0) this.logger.log(`numbered the wormholes of ${maps.length} map(s)`);
  }

  onModuleInit(): void {
    this.registry.registerSnapshot('map', (mapId, actor) => this.snapshots.snapshot(actor, mapId));
    // Jumps through a connection become passages. Auto-mapping adds the connection only after the
    // jump that found it, so a new connection also looks back for the jumps just before it.
    this.consumers.register({
      name: 'mapping.passages',
      streams: ['map'],
      types: ['character.jumped', 'connection.added'],
      handle: async (event) => {
        if (isEventOfType(event, 'character.jumped')) await this.recordJump(event);
        else if (isEventOfType(event, 'connection.added')) {
          const { source, target } = event.data;
          const earlier = await this.log.readSince(
            event.stream,
            Math.max(0, event.seq - 1 - LOOK_BACK),
            LOOK_BACK,
          );
          for (const jump of earlier) {
            if (jump.seq >= event.seq || !isEventOfType(jump, 'character.jumped')) continue;
            const pair = new Set([jump.data.from, jump.data.to]);
            if (pair.has(source) && pair.has(target)) await this.recordJump(jump);
          }
        }
      },
    });
    // Access answers map roles from map ownership; it cannot inject mapping directly (DI cycle).
    this.ownershipRegistry.use(this.ownership);
  }

  private async recordJump(event: DomainEvent): Promise<void> {
    const stream = parseStream(event.stream);
    if (stream?.kind !== 'map' || !isEventOfType(event, 'character.jumped')) return;
    await this.passages.record({
      mapId: stream.id,
      eventId: event.id,
      characterId: event.data.characterId,
      shipTypeId: event.data.shipTypeId,
      from: event.data.from,
      to: event.data.to,
      occurredAt: event.occurredAt,
    });
  }
}

/** How many events before a new connection the jump that discovered it may lie. */
const LOOK_BACK = 50;
