import { join } from 'node:path';
import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ValidationError, type Clock, type EventBus, type EventLog, type MapAccess } from '@wormwright/core';
import { Database } from '@wormwright/db';
import { NotifierRegistry } from '@wormwright/notifications';
import type { UniverseCatalog } from '@wormwright/mapping';
import { PluginAdmin, ThemeAdmin } from '@wormwright/plugins';
import { isEventOfType, type MapSnapshot } from '@wormwright/shared';
import { builtInThemes } from '@wormwright/theme-sdk';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KyselyPluginRepository,
  KyselyThemeRepository,
} from '../../adapters/plugins/kysely-plugin-repository.js';
import type { AppConfig } from '../../config/config.js';
import { FilePluginInstaller } from '../../plugins/installer.js';
import { PluginCommandRegistry } from '../../plugins/plugin-commands.js';
import { PluginHost, PluginPortProviders } from '../../plugins/plugin-host.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { FilePluginSettingsSchemas } from '../../plugins/settings-schemas.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  MAP_ACCESS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { PluginRuntimeController, PluginsAdminController } from './plugins.controller.js';
import { ThemesController } from './themes.controller.js';

const MAX_UPLOAD = 20 * 1024 * 1024;
const UPLOAD_TYPES = ['application/gzip', 'application/x-gzip', 'application/octet-stream'];

const NotificationInput = z.object({
  mapId: z.string().nullable(),
  title: z.string().min(1).max(256),
  body: z.string().max(4000),
  url: z.url().optional(),
});

/** Starts plugins once every module is ready, wires their ports and accepts .tgz uploads. */
@Injectable()
export class PluginsLifecycle implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
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
  ) {}

  onModuleInit(): void {
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

    // Plugins read maps through the same providers that build realtime snapshots.
    this.providers.mapSnapshot = (mapId) => this.mapSnapshot(mapId);
    this.providers.universe = {
      getSystem: (id) => this.universe.getSystem(id),
      searchSystems: (query, limit = 20) => this.universe.searchSystems(query, limit),
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.host.start();
  }

  async onApplicationShutdown(): Promise<void> {
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
      ) => new ThemeAdmin({ themes, installer, uow, clock, builtInIds: builtInThemes.map((t) => t.id) }),
      inject: [KyselyThemeRepository, FilePluginInstaller, UNIT_OF_WORK, CLOCK],
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
      ],
    },
    PluginsLifecycle,
  ],
  exports: [PluginPortProviders, PluginCommandRegistry],
})
export class PluginsModule {}
