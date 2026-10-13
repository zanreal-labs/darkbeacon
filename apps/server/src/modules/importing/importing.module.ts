import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AccessRules, InstanceSettingsService } from '@darkbeacon/access';
import {
  parseStream,
  type Clock,
  type EventLog,
  type Leadership,
  type MapAccess,
  type Signals,
  type UnitOfWork,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { EveDirectoryService } from '@darkbeacon/identity';
import {
  ImportRunner,
  ImportService,
  readExportFile,
  SyncScheduler,
  type ImportingDeps,
} from '@darkbeacon/importing';
import {
  ChainImportUseCases,
  CommentUseCases,
  StructureUseCases,
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  type MappingPorts,
  type UniverseCatalog,
} from '@darkbeacon/mapping';
import { WebhookAdmin } from '@darkbeacon/notifications';
import { HubAdmin, RouteQueries } from '@darkbeacon/routing';
import type { FastifyInstance } from 'fastify';
import {
  KyselyImportJobRepository,
  KyselyImportLinkRepository,
  KyselyImportSyncRepository,
} from '../../adapters/importing/kysely-import-repositories.js';
import {
  AccessRulesTarget,
  CatalogSystemNames,
  EveDirectoryNames,
  MappingChainTarget,
  MapWebhooksTarget,
} from '../../adapters/importing/targets.js';
import { WandererDatabaseSource } from '../../adapters/importing/wanderer-db.js';
import { WandererFileSource, WandererHttpSource } from '../../adapters/importing/wanderer-http.js';
import { SecretBox } from '../../adapters/notifications/secret-box.js';
import type { AppConfig } from '../../config/config.js';
import { AsyncAuditScope } from '../../platform/audit.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { MaintenanceMode } from '../../platform/maintenance.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_LOG,
  LEADERSHIP,
  MAP_ACCESS,
  SIGNALS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAPPING_PORTS } from '../mapping/mapping.tokens.js';
import { RoutingModule } from '../routing/routing.module.js';
import { acceptExportUploads } from './export-upload.js';
import { ImportsController } from './importing.controller.js';

const IMPORTING_DEPS = 'ImportingDeps';
/** Due syncs are looked for this often. */
const SYNC_TICK_MS = 30_000;
const PRUNE_MS = 3_600_000;
/** Signal asking the replica that runs jobs (the leader) to look for queued ones. */
const IMPORTS_QUEUED = 'imports.queued';

/**
 * Starts the job runner (resuming jobs a restart interrupted), pulls due syncs, follows deleted
 * maps, serves `import:<jobId>` streams to the account that runs the job, and accepts export
 * file uploads. Jobs and syncs run on one replica (the leader): a job queued on another is
 * signalled to it, and a new leader resumes what the old one left running.
 */
@Injectable()
export class ImportingRuntime implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Imports');
  private timers: NodeJS.Timeout[] = [];
  private unsubscribe: Array<() => void> = [];

  constructor(
    @Inject(ImportService) private readonly service: ImportService,
    @Inject(ImportRunner) private readonly runner: ImportRunner,
    @Inject(SyncScheduler) private readonly scheduler: SyncScheduler,
    @Inject(IMPORTING_DEPS) private readonly deps: ImportingDeps,
    @Inject(RealtimeRegistry) private readonly realtime: RealtimeRegistry,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
    @Inject(AsyncAuditScope) private readonly audit: AsyncAuditScope,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MaintenanceMode) private readonly maintenance: MaintenanceMode,
    @Inject(LEADERSHIP) private readonly leadership: Leadership,
    @Inject(SIGNALS) private readonly signals: Signals,
  ) {}

  onModuleInit(): void {
    acceptExportUploads(this.http.httpAdapter.getInstance<FastifyInstance>());
    this.realtime.registerStream('import', {
      authorize: (actor, jobId) => this.service.canFollow(actor, jobId),
    });
    this.realtime.registerSnapshot('import', async (jobId, actor) => ({
      job: await this.service.get(actor, jobId),
    }));
    // A restore replaces the database: jobs stop where they are and syncs wait.
    this.maintenance.register({
      name: 'imports',
      pause: () => this.runner.pause(),
      resume: () => {
        this.audit.detached(() => {
          void this.runner.resume().catch((error: unknown) => this.logger.error(String(error)));
        });
      },
    });
    this.consumers.register({
      name: 'importing.removed-maps',
      streams: ['map'],
      types: ['map.removed'],
      handle: async (event) => {
        const stream = parseStream(event.stream);
        if (stream?.kind !== 'map') return;
        await this.deps.links.forgetMap(stream.id);
        await this.deps.syncs.forgetMap(stream.id);
      },
    });
  }

  onApplicationBootstrap(): void {
    this.unsubscribe.push(
      this.signals.subscribe(IMPORTS_QUEUED, () => {
        if (this.leadership.isLeader()) this.wake();
      }),
      this.leadership.onChange((leader) => {
        if (leader) this.wake();
      }),
    );
    this.wake();
    if (this.config.env === 'test') return;
    const every = (ms: number, work: () => Promise<unknown>) => {
      const timer = setInterval(() => {
        this.audit.detached(() => void work().catch((error: unknown) => this.logger.warn(String(error))));
      }, ms);
      timer.unref();
      this.timers.push(timer);
    };
    const leading = () => this.leadership.isLeader() && !this.maintenance.active;
    every(SYNC_TICK_MS, () => (leading() ? this.scheduler.tick() : Promise.resolve()));
    every(PRUNE_MS, () => (leading() ? this.service.prune() : Promise.resolve()));
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
  }

  /** Runs queued jobs outside whatever request asked for it, on the leader (told by a signal). */
  wake(): void {
    if (!this.leadership.isLeader()) {
      this.signals.publish(IMPORTS_QUEUED, null);
      return;
    }
    this.audit.detached(() => {
      void this.runner.drain().catch((error: unknown) => this.logger.error(String(error)));
    });
  }
}

/**
 * Imports from Wanderer (`/api/imports/*`): sources (API and export file), previews, jobs,
 * syncs. Writes go through the mapping, access and routing use cases.
 */
@Module({
  imports: [MappingModule, RoutingModule],
  controllers: [ImportsController],
  providers: [
    {
      provide: ChainImportUseCases,
      useFactory: (ports: MappingPorts) => new ChainImportUseCases(ports),
      inject: [MAPPING_PORTS],
    },
    {
      provide: IMPORTING_DEPS,
      useFactory: (
        database: Database,
        config: AppConfig,
        maps: MapUseCases,
        systems: SystemUseCases,
        connections: ConnectionUseCases,
        signatures: SignatureUseCases,
        imports: ChainImportUseCases,
        access: MapAccess,
        rules: AccessRules,
        webhooks: WebhookAdmin,
        hubs: HubAdmin,
        routes: RouteQueries,
        eve: EveDirectoryService,
        universe: UniverseCatalog,
        settings: InstanceSettingsService,
        events: EventLog,
        uow: UnitOfWork,
        clock: Clock,
        audit: AsyncAuditScope,
        comments: CommentUseCases,
        structures: StructureUseCases,
      ): ImportingDeps => {
        const box = new SecretBox(config.secretKey, 'wanderer-import');
        const deps: ImportingDeps = {
          sources: {
            api: new WandererHttpSource(),
            db: new WandererDatabaseSource(),
            file: new WandererFileSource((document, fileName) =>
              readExportFile(document, fileName, clock.now()),
            ),
          },
          target: new MappingChainTarget(
            { maps, systems, connections, signatures, imports, comments, structures },
            access,
            hubs,
            routes,
          ),
          access: new AccessRulesTarget(rules),
          webhooks: new MapWebhooksTarget(webhooks),
          names: new EveDirectoryNames(eve),
          universe: new CatalogSystemNames(universe),
          jobs: new KyselyImportJobRepository(database),
          links: new KyselyImportLinkRepository(database),
          syncs: new KyselyImportSyncRepository(database),
          secrets: { seal: (plain) => box.seal(plain), open: (sealed) => box.open(sealed) },
          policy: {
            allowPrivateNetworks: async () => (await settings.current()).importsFromPrivateNetworks ?? false,
          },
          events,
          uow,
          clock,
          audit,
          // Replaced by ImportingRuntime.wake once the runtime exists (see below).
          wake: () => undefined,
        };
        return deps;
      },
      inject: [
        Database,
        APP_CONFIG,
        MapUseCases,
        SystemUseCases,
        ConnectionUseCases,
        SignatureUseCases,
        ChainImportUseCases,
        MAP_ACCESS,
        AccessRules,
        WebhookAdmin,
        HubAdmin,
        RouteQueries,
        EveDirectoryService,
        UNIVERSE_CATALOG,
        InstanceSettingsService,
        EVENT_LOG,
        UNIT_OF_WORK,
        CLOCK,
        AsyncAuditScope,
        CommentUseCases,
        StructureUseCases,
      ],
    },
    {
      provide: ImportRunner,
      useFactory: (deps: ImportingDeps) => new ImportRunner(deps),
      inject: [IMPORTING_DEPS],
    },
    {
      provide: ImportService,
      useFactory: (deps: ImportingDeps, runner: ImportRunner) => new ImportService(deps, runner),
      inject: [IMPORTING_DEPS, ImportRunner],
    },
    {
      provide: SyncScheduler,
      useFactory: (deps: ImportingDeps) => new SyncScheduler(deps),
      inject: [IMPORTING_DEPS],
    },
    ImportingRuntime,
  ],
  exports: [ImportService, ImportRunner, SyncScheduler, IMPORTING_DEPS],
})
export class ImportingModule {
  constructor(
    @Inject(IMPORTING_DEPS) deps: ImportingDeps,
    @Inject(ImportingRuntime) runtime: ImportingRuntime,
  ) {
    deps.wake = () => runtime.wake();
  }
}

export { IMPORTING_DEPS };
