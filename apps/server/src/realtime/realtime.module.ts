import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import type { EventBus, EventLog } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import type { DomainTelemetry } from '@darkbeacon/observability';
import { AuditDirectoryRegistry } from '../platform/audit.js';
import { EVENT_BUS, EVENT_LOG, OBSERVABILITY } from '../platform/tokens.js';
import { PresenceRooms } from './presence.js';
import { PresenceSettingsController, PresenceSettingsStore } from './presence-settings.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeHub } from './realtime.hub.js';
import { RealtimeRegistry } from './realtime.registry.js';
import { SnapshotController } from './snapshot.controller.js';

/**
 * WebSocket gateway at /ws, with presence on map streams. Feature modules inject
 * RealtimeRegistry to add stream kinds and snapshots, and PresenceRooms to read who is on a map.
 */
@Global()
@Module({
  controllers: [SnapshotController, PresenceSettingsController],
  providers: [
    RealtimeRegistry,
    { provide: PresenceRooms, useFactory: () => new PresenceRooms() },
    PresenceSettingsStore,
    {
      provide: RealtimeHub,
      useFactory: (
        log: EventLog,
        bus: EventBus,
        registry: RealtimeRegistry,
        database: Database,
        rooms: PresenceRooms,
        directory: AuditDirectoryRegistry,
        settings: PresenceSettingsStore,
        telemetry?: DomainTelemetry | null,
      ) => {
        const logger = new Logger('Realtime');
        return new RealtimeHub({
          log,
          bus,
          registry,
          database,
          presence: {
            rooms,
            settings: (accountId) => settings.get(accountId),
            identify: async (accountId) => {
              const account = await directory.account(accountId);
              return {
                accountId,
                name: account?.name ?? 'Unknown pilot',
                characterId: account?.mainCharacterId ?? null,
                characterName: account?.mainCharacterName ?? null,
              };
            },
          },
          onError: (error) =>
            logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error)),
          ...(telemetry
            ? { trace: (name, attributes, work) => telemetry.traced(name, attributes, work) }
            : {}),
        });
      },
      inject: [
        EVENT_LOG,
        EVENT_BUS,
        RealtimeRegistry,
        Database,
        PresenceRooms,
        AuditDirectoryRegistry,
        PresenceSettingsStore,
        { token: OBSERVABILITY, optional: true },
      ],
    },
    RealtimeGateway,
  ],
  exports: [RealtimeRegistry, PresenceRooms, RealtimeHub],
})
export class RealtimeModule implements OnModuleDestroy {
  constructor(@Inject(PresenceRooms) private readonly rooms: PresenceRooms) {}

  onModuleDestroy(): void {
    this.rooms.close();
  }
}
