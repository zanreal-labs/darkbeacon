import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EventBus } from '@darkbeacon/core';
import type { DomainTelemetry } from '@darkbeacon/observability';
import { isEventOfType } from '@darkbeacon/shared';
import {
  AutoMapper,
  ListMapCharacters,
  ServerStatusWatch,
  STATUS_INTERVAL_MS,
  TrackingCleanup,
  TrackingPoller,
  type MapCharacterSettingsRepository,
} from '@darkbeacon/tracking';
import type { AppConfig } from '../../config/config.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { APP_CONFIG, EVENT_BUS, OBSERVABILITY } from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { OfflineVisibility } from './offline-visibility.js';
import { MAP_CHARACTER_SETTINGS } from './tracking.tokens.js';

/**
 * Starts the ESI poller, runs auto-mapping and the cleanups after deleted maps and characters
 * that changed hands as durable event-log consumers, and contributes `characters` to map
 * snapshots. Access changes make the poller check the tracking accounts' roles again.
 */
@Injectable()
export class TrackingRuntime implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private statusTimer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private polling = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TrackingPoller) private readonly poller: TrackingPoller,
    @Inject(AutoMapper) private readonly autoMapper: AutoMapper,
    @Inject(ListMapCharacters) private readonly listCharacters: ListMapCharacters,
    @Inject(RealtimeRegistry) private readonly registry: RealtimeRegistry,
    @Inject(TrackingCleanup) private readonly cleanup: TrackingCleanup,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
    @Inject(OfflineVisibility) private readonly offline: OfflineVisibility,
    @Inject(ServerStatusWatch) private readonly serverStatus: ServerStatusWatch,
    @Inject(MAP_CHARACTER_SETTINGS) private readonly mapSettings: MapCharacterSettingsRepository,
    @Optional() @Inject(OBSERVABILITY) private readonly telemetry?: DomainTelemetry | null,
  ) {}

  onModuleInit(): void {
    this.registry.registerSnapshot('map', async (mapId, actor) => ({
      characters: await this.offline.filterList(actor, mapId, await this.listCharacters.forMap(mapId)),
    }));
    // Offline characters for managers only, on maps that ask for it.
    this.registry.registerEventFilter('map', (actor, mapId, event) =>
      this.offline.filterEvent(actor, mapId, event),
    );
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
        if (!isEventOfType(event, 'map.removed')) return;
        await this.cleanup.forgetMap(event.data.id);
        await this.mapSettings.forgetMap(event.data.id);
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
    const unsubscribeAccess = this.bus.subscribe(() => this.poller.recheckAccess(), { types: ['access.*'] });
    // The offline option and roles are cached briefly; changes read them again at once.
    const unsubscribeSettings = this.bus.subscribe(
      (event) => this.offline.forget(event.stream.slice('map:'.length)),
      { types: ['map.settings_changed', 'access.*'] },
    );
    this.unsubscribe = () => {
      unsubscribeAccess();
      unsubscribeSettings();
    };
    this.maintenance.register({
      name: 'tracking',
      resume: (restored) => {
        if (restored) this.poller.recheckAccess();
      },
    });
  }

  onApplicationBootstrap(): void {
    // Tests drive the poller themselves.
    if (this.config.env !== 'test') {
      this.timer = setInterval(() => void this.tick(), 1000).unref();
      // Downtime: TQ's status decides whether polling characters makes sense.
      void this.serverStatus.refresh();
      this.statusTimer = setInterval(() => void this.serverStatus.refresh(), STATUS_INTERVAL_MS).unref();
    }
  }

  private async tick(): Promise<void> {
    if (this.maintenance.active || this.serverStatus.paused) return;
    const telemetry = this.telemetry;
    if (!telemetry) return this.poller.tick();
    // A poll still running makes the next tick a no-op; only whole polls are measured.
    if (this.polling) return;
    this.polling = true;
    const started = performance.now();
    try {
      await this.poller.tick();
    } finally {
      this.polling = false;
      telemetry.trackingPolled((performance.now() - started) / 1000);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.statusTimer);
    this.unsubscribe?.();
  }
}
