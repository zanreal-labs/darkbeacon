import {
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  parseStream,
  type AuditScope,
  type Clock,
  type DomainEvent,
  type EventBus,
  type EventLog,
  type Leadership,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import type { ChainOverlaySlot, MappingPorts } from '@darkbeacon/mapping';
import {
  ChainMerger,
  ChainWrites,
  SharingFeed,
  SharingUseCases,
  type SharingPorts,
} from '@darkbeacon/sharing';
import { ListMapCharacters } from '@darkbeacon/tracking';
import {
  KyselyChainLayoutRepository,
  KyselyChainViewRepository,
  KyselyCompositeMaps,
  KyselyLocalFieldsRepository,
  KyselyShareRepository,
} from '../../adapters/sharing/kysely-sharing.js';
import { LocalChainSources } from '../../adapters/sharing/local-chain-source.js';
import {
  AUDIT_SCOPE,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  LEADERSHIP,
  MAP_ACCESS,
  UNIT_OF_WORK,
} from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { CHAIN_OVERLAY, MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { SharesController } from './sharing.controllers.js';

export const SHARING_PORTS = 'SharingPorts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How long deletions are remembered for merged maps. */
export const TOMBSTONE_DAYS = 30;

/**
 * Shares between maps and merged chains: maps of this instance are sources through
 * `LocalChainSources` (over mapping and tracking); merged maps get their chain into mapping's
 * overlay slot (snapshots, routing, connection intel) and their sources into the map snapshot.
 * Source changes arrive from the event bus; every merged map is built again at startup, so
 * anything missed while the server was down is published then. With replicas the leader merges
 * (once per change); the others only forget what they kept of a map when its stream moves, and
 * build it again from what is stored when a request needs it.
 */
@Module({
  imports: [MappingModule, TrackingModule],
  controllers: [SharesController],
  providers: [
    {
      provide: SHARING_PORTS,
      useFactory: (
        database: Database,
        mapping: MappingPorts,
        characters: ListMapCharacters,
        access: MapAccess,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
        audit: AuditScope,
      ): SharingPorts => ({
        shares: new KyselyShareRepository(database),
        sources: new LocalChainSources({ ports: mapping, characters, audit }),
        views: new KyselyChainViewRepository(database),
        layout: new KyselyChainLayoutRepository(database),
        local: new KyselyLocalFieldsRepository(database),
        composites: new KyselyCompositeMaps(database),
        access,
        events,
        uow,
        clock,
        audit,
      }),
      inject: [
        Database,
        MAPPING_PORTS,
        ListMapCharacters,
        MAP_ACCESS,
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
        AUDIT_SCOPE,
      ],
    },
    {
      provide: ChainMerger,
      useFactory: (ports: SharingPorts) => new ChainMerger(ports),
      inject: [SHARING_PORTS],
    },
    {
      provide: SharingUseCases,
      useFactory: (ports: SharingPorts, merger: ChainMerger) => new SharingUseCases(ports, merger),
      inject: [SHARING_PORTS, ChainMerger],
    },
    {
      provide: ChainWrites,
      useFactory: (ports: SharingPorts, merger: ChainMerger) => new ChainWrites(ports, merger),
      inject: [SHARING_PORTS, ChainMerger],
    },
  ],
  exports: [ChainMerger, ChainWrites, SharingUseCases],
})
export class SharingModule implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sharing');
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(ChainMerger) private readonly merger: ChainMerger,
    @Inject(SHARING_PORTS) private readonly ports: SharingPorts,
    @Inject(CHAIN_OVERLAY) private readonly overlay: ChainOverlaySlot,
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
    @Inject(MAPPING_PORTS) private readonly mapping: MappingPorts,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
  ) {
    this.feed = new SharingFeed(this.ports, this.merger);
  }

  private readonly feed: SharingFeed;
  private paused = false;
  private pruneTimer: NodeJS.Timeout | undefined;
  private unwatchLeadership: (() => void) | undefined;

  onModuleInit(): void {
    this.overlay.use({
      view: (mapId) => this.merger.chain(mapId),
      passages: (mapId, connection) => this.merger.passages(mapId, connection),
    });
    // After mapping's and tracking's parts, so merged characters replace the map's own list.
    this.registry.registerSnapshot('map', (mapId) => this.merger.snapshot(mapId));
    this.unsubscribe = this.bus.subscribe((event) => this.onEvent(event));
    // A restore replaces the database: what is kept in memory goes, merged maps build again.
    this.maintenance.register({
      name: 'sharing',
      pause: async () => {
        this.paused = true;
        await this.merger.idle();
      },
      resume: async (restored) => {
        this.paused = false;
        if (!restored) return;
        this.merger.reset();
        await this.merger
          .rebuildAll()
          .catch((error: unknown) => this.logger.error(`rebuilding merged maps: ${message(error)}`));
      },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.pruneTimer = setInterval(
      () => void this.pruneTombstones().catch((error: unknown) => this.logger.error(message(error))),
      HOUR_MS,
    ).unref();
    // A replica that starts leading merges what changed while another one led.
    this.unwatchLeadership = this.leadership.onChange((leader) => {
      if (!leader) return;
      this.merger.reset();
      void this.rebuildAll();
    });
    if (this.leadership.isLeader()) await this.rebuildAll();
  }

  private rebuildAll(): Promise<void> {
    return this.merger
      .rebuildAll()
      .catch((error: unknown) => this.logger.error(`rebuilding merged maps: ${message(error)}`));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unwatchLeadership?.();
    clearInterval(this.pruneTimer);
  }

  /** Deletions older than 30 days are forgotten (a very old copy elsewhere may then show again). */
  private async pruneTombstones(): Promise<void> {
    if (this.paused || !this.leadership.isLeader()) return;
    const pruned = await this.mapping.stamps.pruneTombstones(
      this.ports.clock.now() - TOMBSTONE_DAYS * DAY_MS,
    );
    if (pruned > 0) this.logger.log(`forgot ${pruned} deletion(s) older than ${TOMBSTONE_DAYS} days`);
  }

  private onEvent(event: DomainEvent): void {
    if (this.paused) return;
    if (!this.leadership.isLeader()) {
      const stream = parseStream(event.stream);
      if (stream?.kind === 'map') this.merger.forget(stream.id);
      return;
    }
    this.feed
      .handle(event)
      .catch((error: unknown) =>
        this.logger.error(`merging ${event.type} of ${event.stream}: ${message(error)}`),
      );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
