import { Global, Logger, Module } from '@nestjs/common';
import type { EventBus, EventLog } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { EVENT_BUS, EVENT_LOG } from '../platform/tokens.js';
import { EventRetention } from './event-retention.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeHub } from './realtime.hub.js';
import { RealtimeRegistry } from './realtime.registry.js';

/** WebSocket gateway at /ws. Feature modules inject RealtimeRegistry to add stream kinds and snapshots. */
@Global()
@Module({
  providers: [
    RealtimeRegistry,
    {
      provide: RealtimeHub,
      useFactory: (log: EventLog, bus: EventBus, registry: RealtimeRegistry, database: Database) => {
        const logger = new Logger('Realtime');
        return new RealtimeHub({
          log,
          bus,
          registry,
          database,
          onError: (error) =>
            logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error)),
        });
      },
      inject: [EVENT_LOG, EVENT_BUS, RealtimeRegistry, Database],
    },
    RealtimeGateway,
    EventRetention,
  ],
  exports: [RealtimeRegistry],
})
export class RealtimeModule {}
