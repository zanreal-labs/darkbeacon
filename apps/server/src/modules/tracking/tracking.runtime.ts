import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EventBus } from '@wormwright/core';
import { AutoMapper, ListMapCharacters, TrackingPoller } from '@wormwright/tracking';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, EVENT_BUS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';

/** Starts the ESI poller, subscribes auto-mapping and contributes `characters` to map snapshots. */
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
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', async (mapId) => ({
      characters: await this.listCharacters.forMap(mapId),
    }));
    this.unsubscribe = this.bus.subscribe((event) => this.autoMapper.handle(event), {
      types: ['character.jumped'],
    });
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
