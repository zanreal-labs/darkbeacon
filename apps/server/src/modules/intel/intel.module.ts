import { readFileSync } from 'node:fs';
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  Query,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  parseStream,
  type Actor,
  type Clock,
  type EventBus,
  type EventLog,
  type MapAccess,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  DEFAULT_KILL_DAYS,
  IntelJobs,
  IntelNames,
  IntelQueries,
  type IntelRepository,
} from '@darkbeacon/intel';
import type { MappingPorts } from '@darkbeacon/mapping';
import type { DomainTelemetry } from '@darkbeacon/observability';
import { EveId, MapKillsQuery, nestPath, routes } from '@darkbeacon/shared';
import { z } from 'zod';
import {
  EsiActivitySource,
  EsiNameResolver,
  EsiPublicClient,
  EsiSovereigntySource,
} from '../../adapters/intel/esi-intel-http.js';
import { KyselyIntelRepository } from '../../adapters/intel/kysely-intel-repository.js';
import {
  CatalogIntelUniverse,
  HubIntelPublisher,
  MappingIntelSystems,
  TelemetryIntelMetrics,
} from '../../adapters/intel/server-ports.js';
import { R2z2KillFeed, ZkillHistory } from '../../adapters/intel/zkill-http.js';
import type { StaticUniverseCatalog } from '../../adapters/universe/static-universe-catalog.js';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_BUS,
  EVENT_LOG,
  HTTP_FETCH,
  MAP_ACCESS,
  OBSERVABILITY,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeHub } from '../../realtime/realtime.hub.js';
import { MappingModule } from '../mapping/mapping.module.js';
import { MAPPING_PORTS } from '../mapping/mapping.tokens.js';

const INTEL_REPOSITORY = 'IntelRepository';
const INTEL_OPTIONS = 'IntelOptions';
/** Whether the live feed runs: the jobs know, the queries ask (the jobs are built after them). */
const INTEL_LIVE = 'IntelLive';
interface LiveFlag {
  current(): boolean;
}

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export type IntelSourceName = 'esi' | 'zkill' | 'r2z2';

export interface IntelOptions {
  /** Outside sources that are asked; none in tests. */
  sources: ReadonlySet<IntelSourceName>;
  killDays: number;
}

/**
 * Operational switches, like the OTEL_* variables (read where they are used, not part of the
 * first-login configuration): `INTEL_SOURCES` lists the sources to ask (`esi`: sovereignty and
 * hourly figures, `zkill`: history of systems new to the maps, `r2z2`: zKillboard's live feed;
 * default all three, `none` for none), `INTEL_KILL_DAYS` how long killmails are kept (1-30,
 * default 7). Tests ask nothing.
 */
export function intelOptions(env: NodeJS.ProcessEnv, config: Pick<AppConfig, 'env'>): IntelOptions {
  const all: IntelSourceName[] = ['esi', 'zkill', 'r2z2'];
  const raw = env.INTEL_SOURCES?.trim().toLowerCase();
  const listed =
    raw === undefined || raw === ''
      ? config.env === 'test'
        ? []
        : all
      : raw.split(',').map((s) => s.trim());
  const unknown = listed.filter((s) => s !== 'none' && !all.includes(s as IntelSourceName));
  if (unknown.length > 0)
    throw new Error(`INTEL_SOURCES: unknown source ${unknown.join(', ')} (use ${all.join(', ')} or none)`);
  const days = env.INTEL_KILL_DAYS ? Number(env.INTEL_KILL_DAYS) : DEFAULT_KILL_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error('INTEL_KILL_DAYS: a whole number of days from 1 to 30');
  return {
    sources: new Set(listed.filter((s): s is IntelSourceName => all.includes(s as IntelSourceName))),
    killDays: days,
  };
}

@Controller()
export class IntelController {
  constructor(@Inject(IntelQueries) private readonly queries: IntelQueries) {}

  @Get(nestPath(routes.intel.map.path))
  map(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.queries.mapIntel(actor, mapId);
  }

  @Get(nestPath(routes.intel.system.path))
  system(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', new ZodPipe(z.coerce.number().pipe(EveId))) solarSystemId: number,
  ) {
    return this.queries.systemActivity(actor, mapId, solarSystemId);
  }

  @Get(nestPath(routes.intel.kills.path))
  kills(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(MapKillsQuery)) query: MapKillsQuery,
  ) {
    return this.queries.mapKills(actor, mapId, query);
  }
}

/** Every few seconds whatever job is due; systems added to or removed from maps re-scope the feed. */
const TICK_MS = 5_000;
const SYSTEMS_DEBOUNCE_MS = 1_000;

@Injectable()
export class IntelRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Intel');
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(IntelJobs) private readonly jobs: IntelJobs,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(INTEL_OPTIONS) private readonly options: IntelOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.options.sources.size === 0) return;
    this.logger.log(
      `following ${[...this.options.sources].join(', ')}; killmails kept ${this.options.killDays} days`,
    );
    await this.jobs.start();
    this.timer = setInterval(() => {
      void this.jobs.tick();
    }, TICK_MS);
    this.timer.unref();
    void this.jobs.tick();
    this.unsubscribe = this.bus.subscribe(
      (event) => {
        const stream = parseStream(event.stream);
        if (stream?.kind !== 'map') return;
        clearTimeout(this.pending.get(stream.id));
        this.pending.set(
          stream.id,
          setTimeout(() => {
            this.pending.delete(stream.id);
            this.jobs.systemsChanged(stream.id).catch((error: unknown) => this.logger.warn(String(error)));
          }, SYSTEMS_DEBOUNCE_MS).unref(),
        );
      },
      { types: ['system.added', 'system.removed', 'system.updated', 'map.removed', 'map.sources_changed'] },
    );
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.unsubscribe?.();
    for (const timer of this.pending.values()) clearTimeout(timer);
    await this.jobs.stop();
  }
}

/**
 * System intel: sovereignty and ESI's hourly figures, zKillboard's killmails of systems on maps,
 * names from ESI; `GET /api/maps/:mapId/intel`, `.../intel/systems/:id`, `.../kills`, pushes to
 * the maps' viewers and `kill.reported` events.
 */
@Module({
  imports: [MappingModule],
  controllers: [IntelController],
  providers: [
    { provide: INTEL_LIVE, useFactory: (): LiveFlag => ({ current: () => false }) },
    {
      provide: INTEL_OPTIONS,
      useFactory: (config: AppConfig) => intelOptions(process.env, config),
      inject: [APP_CONFIG],
    },
    {
      provide: INTEL_REPOSITORY,
      useFactory: (database: Database) => new KyselyIntelRepository(database),
      inject: [Database],
    },
    {
      provide: EsiPublicClient,
      useFactory: (config: AppConfig, clock: Clock, fetchFn: typeof fetch) =>
        new EsiPublicClient({
          clock,
          fetch: fetchFn,
          userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
        }),
      inject: [APP_CONFIG, CLOCK, HTTP_FETCH],
    },
    {
      provide: IntelNames,
      useFactory: (repo: IntelRepository, client: EsiPublicClient, clock: Clock) => {
        const logger = new Logger('Intel');
        return new IntelNames({
          repo,
          resolver: new EsiNameResolver(client),
          clock,
          onError: (error) => logger.warn(`names: ${error instanceof Error ? error.message : String(error)}`),
        });
      },
      inject: [INTEL_REPOSITORY, EsiPublicClient, CLOCK],
    },
    {
      provide: MappingIntelSystems,
      useFactory: (database: Database, ports: MappingPorts) => new MappingIntelSystems(database, ports),
      inject: [Database, MAPPING_PORTS],
    },
    {
      provide: IntelQueries,
      useFactory: (
        repo: IntelRepository,
        names: IntelNames,
        systems: MappingIntelSystems,
        universe: StaticUniverseCatalog,
        access: MapAccess,
        clock: Clock,
        live: LiveFlag,
      ) =>
        new IntelQueries({
          repo,
          names,
          systems,
          universe: new CatalogIntelUniverse(universe),
          access,
          clock,
          live: () => live.current(),
        }),
      inject: [
        INTEL_REPOSITORY,
        IntelNames,
        MappingIntelSystems,
        UNIVERSE_CATALOG,
        MAP_ACCESS,
        CLOCK,
        INTEL_LIVE,
      ],
    },
    {
      provide: IntelJobs,
      useFactory: (
        options: IntelOptions,
        config: AppConfig,
        repo: IntelRepository,
        queries: IntelQueries,
        systems: MappingIntelSystems,
        hub: RealtimeHub,
        events: EventLog,
        client: EsiPublicClient,
        clock: Clock,
        fetchFn: typeof fetch,
        live: LiveFlag,
        telemetry?: DomainTelemetry | null,
      ) => {
        const logger = new Logger('Intel');
        const metrics = telemetry ? new TelemetryIntelMetrics(telemetry) : null;
        const zkill = {
          clock,
          fetch: fetchFn,
          metrics,
          userAgent: `Darkbeacon/${version} (+${config.publicUrl}; self-hosted wormhole mapper)`,
        };
        const has = (s: IntelSourceName) => options.sources.has(s);
        const jobs = new IntelJobs({
          repo,
          queries,
          systems,
          publisher: new HubIntelPublisher(hub),
          events,
          clock,
          metrics,
          killDays: options.killDays,
          ...(has('esi')
            ? { activity: new EsiActivitySource(client), sovereignty: new EsiSovereigntySource(client) }
            : {}),
          ...(has('zkill') ? { history: new ZkillHistory(zkill) } : {}),
          ...(has('r2z2')
            ? {
                feed: new R2z2KillFeed({
                  ...zkill,
                  load: () => repo.state('r2z2'),
                  save: (position) => repo.setState('r2z2', position),
                }),
              }
            : {}),
          onError: (job, error) =>
            logger.warn(`${job}: ${error instanceof Error ? error.message : String(error)}`),
        });
        live.current = () => jobs.live();
        return jobs;
      },
      inject: [
        INTEL_OPTIONS,
        APP_CONFIG,
        INTEL_REPOSITORY,
        IntelQueries,
        MappingIntelSystems,
        RealtimeHub,
        EVENT_LOG,
        EsiPublicClient,
        CLOCK,
        HTTP_FETCH,
        INTEL_LIVE,
        { token: OBSERVABILITY, optional: true },
      ],
    },
    IntelRuntime,
  ],
  exports: [IntelQueries, IntelJobs],
})
export class IntelModule {}
