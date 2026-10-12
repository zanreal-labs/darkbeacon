import { Inject, Module, type OnModuleInit } from '@nestjs/common';
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
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapSnapshotQuery,
  PassageRecorder,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type MapRepository,
  type MappingPorts,
  type UniverseCatalog,
} from '@darkbeacon/mapping';
import {
  KyselyConnectionRepository,
  KyselyMapRepository,
  KyselyPassageRepository,
  KyselySignatureRepository,
  KyselySystemRepository,
} from '../../adapters/mapping/kysely-repositories.js';
import { MappingMapOwnership } from '../../adapters/mapping/map-ownership.js';
import { isEventOfType } from '@darkbeacon/shared';
import { EventConsumers } from '../../platform/event-consumers.js';
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
        passages: new KyselyPassageRepository(database),
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
    useCase(ConnectionIntelQuery),
    useCase(PassageRecorder),
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
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(PassageRecorder) private readonly passages: PassageRecorder,
    @Inject(EVENT_LOG) private readonly log: EventLog,
  ) {}

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
