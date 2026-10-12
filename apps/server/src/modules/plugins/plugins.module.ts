import { join } from 'node:path';
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ValidationError,
  type Clock,
  type EventBus,
  type EventLog,
  type Leadership,
  type MapAccess,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { NotifierRegistry } from '@darkbeacon/notifications';
import type { UniverseCatalog } from '@darkbeacon/mapping';
import type { DomainTelemetry } from '@darkbeacon/observability';
import { PluginAdmin, ThemeAdmin } from '@darkbeacon/plugins';
import { isEventOfType, type MapSnapshot } from '@darkbeacon/shared';
import { builtInThemes, SYSTEM_THEME_ID } from '@darkbeacon/theme-sdk';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DiscordBotService } from '@darkbeacon/identity';
import { SecretBox } from '../../adapters/identity/secret-box.js';
import {
  KyselyBundledPluginMarks,
  KyselyPluginRepository,
  KyselyThemeRepository,
} from '../../adapters/plugins/kysely-plugin-repository.js';
import type { AppConfig } from '../../config/config.js';
import { FilePluginInstaller } from '../../plugins/installer.js';
import { PluginCommandRegistry } from '../../plugins/plugin-commands.js';
import { PluginHost, PluginPortProviders } from '../../plugins/plugin-host.js';
import { PresenceRooms } from '../../realtime/presence.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import { SignInCookies } from '../../platform/sign-in-cookies.js';
import { FilePluginSettingsSchemas } from '../../plugins/settings-schemas.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  LEADERSHIP,
  MAP_ACCESS,
  OBSERVABILITY,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { PluginRuntimeController, PluginsAdminController } from './plugins.controller.js';
import { signInThemeCookies } from './theme-cookie.js';
import { ThemesController } from './themes.controller.js';

const MAX_UPLOAD = 20 * 1024 * 1024;
const UPLOAD_TYPES = ['application/gzip', 'application/x-gzip', 'application/octet-stream'];

const NotificationInput = z.object({
  mapId: z.string().nullable(),
  title: z.string().min(1).max(256),
  body: z.string().max(4000),
  url: z.url().optional(),
});

/** Catalogue folders installed and switched on by default (see `PluginAdmin.ensureBundled`). */
export const BUNDLED_PLUGINS = ['discord-notify'];

/** Starts plugins once every module is ready, wires their ports and accepts .tgz uploads. */
@Injectable()
export class PluginsLifecycle implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Plugins');
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(PluginHost) private readonly host: PluginHost,
    @Inject(PluginPortProviders) private readonly providers: PluginPortProviders,
    @Inject(PluginCommandRegistry) private readonly commands: PluginCommandRegistry,
    @Inject(NotifierRegistry) private readonly notifiers: NotifierRegistry,
    @Inject(RealtimeRegistry) private readonly realtime: RealtimeRegistry,
    @Inject(Database) private readonly database: Database,
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
    @Inject(UNIVERSE_CATALOG) private readonly universe: UniverseCatalog,
    @Inject(PluginAdmin) private readonly admin: PluginAdmin,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(ThemeAdmin) private readonly themes: ThemeAdmin,
    @Inject(SignInCookies) private readonly signInCookies: SignInCookies,
    @Inject(PresenceRooms) private readonly presence: PresenceRooms,
    @Inject(DiscordBotService) private readonly bot: DiscordBotService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
  ) {}

  onModuleInit(): void {
    // Plugins read and write the database from their own timers: unloaded while it is replaced,
    // loaded again from what the (restored) database says is enabled.
    this.maintenance.register({
      name: 'plugins',
      pause: () => this.host.stop(),
      resume: () => this.host.start(),
    });

    const fastify = this.http.httpAdapter.getInstance<FastifyInstance>();
    if (!fastify.hasContentTypeParser('application/gzip')) {
      fastify.addContentTypeParser(
        UPLOAD_TYPES,
        { parseAs: 'buffer', bodyLimit: MAX_UPLOAD },
        (_req, body, done) => done(null, body),
      );
    }

    this.commands.register('notify', async (_actor, input) => {
      const parsed = NotificationInput.safeParse(input);
      if (!parsed.success) throw new ValidationError('Invalid notification', parsed.error.issues);
      const { url, ...rest } = parsed.data;
      await this.notifiers.send(url === undefined ? rest : { ...rest, url });
      return null;
    });

    this.consumers.register({
      name: 'plugins.removed-maps',
      streams: ['map'],
      types: ['map.removed'],
      handle: async (event) => {
        if (isEventOfType(event, 'map.removed')) await this.admin.forgetMap(event.data.id);
      },
    });

    // A new session comes with the account's theme, for the first paint of a new browser.
    this.signInCookies.use((accountId, request, secure) =>
      signInThemeCookies(this.themes, accountId, request, secure),
    );

    // Plugins read maps through the same providers that build realtime snapshots.
    this.providers.mapSnapshot = (mapId) => this.mapSnapshot(mapId);
    this.providers.universe = {
      getSystem: (id) => this.universe.getSystem(id),
      searchSystems: (query, limit = 20) => this.universe.searchSystems(query, limit),
    };
    this.providers.presence = this.presence;
    this.providers.discord = {
      available: () => this.bot.configured(),
      channelLabel: async (guildId, channelId) => {
        const [guilds, channels] = await Promise.all([
          this.bot.guilds().catch(() => []),
          this.bot.channels(guildId).catch(() => []),
        ]);
        const channel = channels.find((c) => c.id === channelId);
        const guild = guilds.find((g) => g.id === guildId);
        return channel ? `#${channel.name}${guild ? ` on ${guild.name}` : ''}` : null;
      },
      send: (channelId, message) => this.bot.send(channelId, message),
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    // Plugins shipped on by default; tests install what they need themselves. With replicas the
    // leader installs them (they share DATA_DIR) and the others load them on the event.
    if (this.config.env !== 'test' && this.leadership.isLeader()) {
      await this.admin
        .ensureBundled(BUNDLED_PLUGINS, new KyselyBundledPluginMarks(this.database))
        .catch((error: unknown) => this.logger.error(`bundled plugins: ${String(error)}`));
    }
    await this.host.start();
    // Another replica installed, switched or removed a plugin: this one follows (once its own
    // plugins are loaded). On the replica that made the change the plugin is already in line,
    // and syncing it again does nothing.
    this.unsubscribe = this.bus.subscribe(
      (event) => {
        const id = isEventOfType(event, 'plugin.removed')
          ? event.data.id
          : (event.data as { id?: string }).id;
        if (id) void this.host.sync(id).catch((error: unknown) => this.logger.error(String(error)));
      },
      { types: ['plugin.updated', 'plugin.removed'] },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubscribe?.();
    await this.host.stop();
  }

  private async mapSnapshot(mapId: string): Promise<MapSnapshot | null> {
    const parts = this.realtime.snapshotProviders('map');
    if (parts.length === 0) return null;
    try {
      return await this.database.transaction(
        async () => {
          const snapshot: Record<string, unknown> = {};
          for (const part of parts)
            Object.assign(snapshot, await part(mapId, { kind: 'plugin', id: 'core' }));
          return snapshot as MapSnapshot;
        },
        { isolation: 'repeatable read' },
      );
    } catch {
      return null;
    }
  }
}

/**
 * Native plugins and theme packages. PluginPortProviders and PluginCommandRegistry are global
 * so other modules can add a universe reader or commands for plugins.
 */
@Global()
@Module({
  controllers: [PluginsAdminController, PluginRuntimeController, ThemesController],
  providers: [
    {
      provide: KyselyPluginRepository,
      useFactory: (db: Database) => new KyselyPluginRepository(db),
      inject: [Database],
    },
    {
      provide: KyselyThemeRepository,
      useFactory: (db: Database) => new KyselyThemeRepository(db),
      inject: [Database],
    },
    {
      provide: FilePluginInstaller,
      useFactory: (config: AppConfig) =>
        new FilePluginInstaller({ pluginsDir: join(config.dataDir, 'plugins') }),
      inject: [APP_CONFIG],
    },
    {
      provide: FilePluginSettingsSchemas,
      useFactory: (installer: FilePluginInstaller) =>
        new FilePluginSettingsSchemas((id) => installer.pluginDir(id)),
      inject: [FilePluginInstaller],
    },
    {
      provide: PluginAdmin,
      useFactory: (
        plugins: KyselyPluginRepository,
        themes: KyselyThemeRepository,
        installer: FilePluginInstaller,
        schemas: FilePluginSettingsSchemas,
        uow: Database,
        log: EventLog,
        clock: Clock,
      ) => new PluginAdmin({ plugins, themes, installer, schemas, uow, log, clock }),
      inject: [
        KyselyPluginRepository,
        KyselyThemeRepository,
        FilePluginInstaller,
        FilePluginSettingsSchemas,
        UNIT_OF_WORK,
        EVENT_LOG,
        CLOCK,
      ],
    },
    {
      provide: ThemeAdmin,
      useFactory: (
        themes: KyselyThemeRepository,
        installer: FilePluginInstaller,
        uow: Database,
        clock: Clock,
        log: EventLog,
      ) =>
        new ThemeAdmin({
          themes,
          installer,
          uow,
          clock,
          log,
          // `system` is a preference (light or dark by the OS), valid wherever a theme id is.
          builtInIds: [SYSTEM_THEME_ID, ...builtInThemes.map((t) => t.id)],
        }),
      inject: [KyselyThemeRepository, FilePluginInstaller, UNIT_OF_WORK, CLOCK, EVENT_LOG],
    },
    { provide: PluginPortProviders, useValue: new PluginPortProviders() },
    { provide: PluginCommandRegistry, useValue: new PluginCommandRegistry() },
    {
      provide: PluginHost,
      useFactory: (
        admin: PluginAdmin,
        plugins: KyselyPluginRepository,
        schemas: FilePluginSettingsSchemas,
        installer: FilePluginInstaller,
        database: Database,
        access: MapAccess,
        bus: EventBus,
        log: EventLog,
        clock: Clock,
        notifiers: NotifierRegistry,
        commands: PluginCommandRegistry,
        providers: PluginPortProviders,
        consumers: EventConsumers,
        config: AppConfig,
        leadership: Leadership,
        telemetry?: DomainTelemetry | null,
      ) =>
        new PluginHost({
          admin,
          plugins,
          schemas,
          database,
          access,
          bus,
          log,
          clock,
          notifiers,
          commands,
          providers,
          pluginDir: (id) => installer.pluginDir(id),
          consumers,
          publicUrl: config.publicUrl,
          secrets: (id) => new SecretBox(config.secretKey, `plugin:${id}`),
          leadership,
          delivered: telemetry ? (channel, ok) => telemetry.notificationDelivered(channel, ok) : undefined,
        }),
      inject: [
        PluginAdmin,
        KyselyPluginRepository,
        FilePluginSettingsSchemas,
        FilePluginInstaller,
        Database,
        MAP_ACCESS,
        EVENT_BUS,
        EVENT_LOG,
        CLOCK,
        NotifierRegistry,
        PluginCommandRegistry,
        PluginPortProviders,
        EventConsumers,
        APP_CONFIG,
        LEADERSHIP,
        { token: OBSERVABILITY, optional: true },
      ],
    },
    PluginsLifecycle,
  ],
  exports: [PluginPortProviders, PluginCommandRegistry],
})
export class PluginsModule {}
