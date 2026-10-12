import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EventBus } from '@darkbeacon/core';
import { isEventOfType } from '@darkbeacon/shared';
import { AutoMapper, ListMapCharacters, TrackingCleanup, TrackingPoller } from '@darkbeacon/tracking';
import type { AppConfig } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { APP_CONFIG, EVENT_BUS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';

/**
 * Starts the ESI poller, runs auto-mapping and the cleanups after deleted maps and characters
 * that changed hands as durable event-log consumers, and contributes `characters` to map
 * snapshots. Access changes make the poller check the tracking accounts' roles again.
 */
@Injectable()
export class TrackingRuntime implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TrackingPoller) private readonly poller: TrackingPoller,
    @Inject(AutoMapper) private readonly autoMapper: AutoMapper,
    @Inject(ListMapCharacters) private readonly listCharacters: ListMapCharacters,
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(TrackingCleanup) private readonly cleanup: TrackingCleanup,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', async (mapId) => ({
      characters: await this.listCharacters.forMap(mapId),
    }));
    this.consumers.register({
      name: 'auto-mapping',
      streams: ['map'],
      types: ['character.jumped'],
      handle: (event) => this.autoMapper.handle(event),
    });
    this.consumers.register({
      name: 'tracking.removed-maps',
      streams: ['map'],
      types: ['map.removed'],
      handle: async (event) => {
        if (isEventOfType(event, 'map.removed')) await this.cleanup.forgetMap(event.data.id);
      },
    });
    this.consumers.register({
      name: 'tracking.unlinked-characters',
      streams: ['instance'],
      types: ['character.unlinked'],
      handle: async (event) => {
        if (isEventOfType(event, 'character.unlinked'))
          await this.cleanup.forgetCharacter(event.data.characterId);
      },
    });
    this.unsubscribe = this.bus.subscribe(() => this.poller.recheckAccess(), { types: ['access.*'] });
  }

  onApplicationBootstrap(): void {
    // Tests drive the poller themselves.
    if (this.config.env !== 'test') {
      this.timer = setInterval(() => void this.poller.tick(), 1000).unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.unsubscribe?.();
  }
}
