import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EventBus } from '@wormwright/core';
import {
  AutoMapper,
  ListMapCharacters,
  TrackingPoller,
  type CharacterTokenSource,
} from '@wormwright/tracking';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, CHARACTER_TOKENS, EVENT_BUS } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';

/** Starts the ESI poller, subscribes auto-mapping and contributes `characters` to map snapshots. */
@Injectable()
export class TrackingRuntime implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Tracking');
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TrackingPoller) private readonly poller: TrackingPoller,
    /** Null when nothing provides AUTO_MAP_TARGET. */
    @Inject(AutoMapper) private readonly autoMapper: AutoMapper | null,
    @Inject(ListMapCharacters) private readonly listCharacters: ListMapCharacters,
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Optional() @Inject(CHARACTER_TOKENS) private readonly characters: CharacterTokenSource | undefined,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', async (mapId) => ({
      characters: await this.listCharacters.forMap(mapId),
    }));
    const autoMapper = this.autoMapper;
    if (autoMapper) {
      this.unsubscribe = this.bus.subscribe((event) => autoMapper.handle(event), {
        types: ['character.jumped'],
      });
    } else {
      this.logger.warn('auto-mapping is off: nothing provides AUTO_MAP_TARGET');
    }
    if (!this.characters) this.logger.warn('characters cannot be tracked: nothing provides CHARACTER_TOKENS');
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
