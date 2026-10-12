import {
  Controller,
  Get,
  Global,
  Inject,
  Injectable,
  Module,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Actor } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import {
  DomainTelemetry,
  METRICS_PATH,
  ObservabilityStatusService,
  scrapeAuthorized,
} from '@darkbeacon/observability';
import { nestPath, routes, type ObservabilityDto } from '@darkbeacon/shared';
import type { FastifyInstance } from 'fastify';
import { listenToEsi } from '../../adapters/observability/esi-listener.js';
import { KyselyGaugeSources } from '../../adapters/observability/kysely-gauge-sources.js';
import { telemetryRuntime, type TelemetryRuntime } from '../../adapters/observability/runtime.js';
import { CurrentActor } from '../../platform/actor.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { EventLogTaps } from '../../platform/event-taps.js';
import { OBSERVABILITY } from '../../platform/tokens.js';
import { RealtimeHub } from '../../realtime/realtime.hub.js';

const TELEMETRY_RUNTIME = 'TelemetryRuntime';

@Controller()
export class ObservabilityController {
  constructor(@Inject(ObservabilityStatusService) private readonly status: ObservabilityStatusService) {}

  @Get(nestPath(routes.admin.observability.path))
  get(@CurrentActor() actor: Actor | null): ObservabilityDto {
    return this.status.status(actor);
  }
}

/**
 * Feeds the instance's measurements to the telemetry SDK while it runs: events this process
 * committed (each counted by one replica only), ESI exchanges (from undici's diagnostics channels), the gauges, and the Prometheus
 * scrape endpoint on the API's own port.
 */
@Injectable()
export class ObservabilityRuntime implements OnModuleInit, OnApplicationShutdown {
  private readonly stops: Array<() => void> = [];

  constructor(
    @Inject(TELEMETRY_RUNTIME) private readonly runtime: TelemetryRuntime,
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
    @Inject(EventLogTaps) private readonly taps: EventLogTaps,
    @Inject(Database) private readonly database: Database,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Optional() @Inject(OBSERVABILITY) private readonly telemetry?: DomainTelemetry | null,
  ) {}

  onModuleInit(): void {
    const scrape = this.runtime.scrape;
    const token = this.runtime.settings.prometheus?.token;
    if (scrape && token) {
      // A route of the API server: the web proxy only takes requests no route matches.
      const fastify = this.http.httpAdapter.getInstance<FastifyInstance>();
      fastify.get(METRICS_PATH, (request, reply) => {
        if (!scrapeAuthorized(request.headers.authorization, token)) {
          void reply
            .code(401)
            .header('www-authenticate', 'Bearer realm="metrics"')
            .header('cache-control', 'no-store')
            .send({
              error: { code: 'unauthenticated', message: 'Send the metrics token as a bearer token' },
            });
          return;
        }
        void reply.hijack();
        scrape(request.raw, reply.raw);
      });
    }
    const telemetry = this.telemetry;
    if (!telemetry) return;
    this.stops.push(
      this.taps.add((events) => telemetry.eventsCommitted(events)),
      listenToEsi((exchange) => telemetry.esiExchange(exchange)),
      telemetry.observe(new KyselyGaugeSources(this.database, this.consumers, this.hub)),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    for (const stop of this.stops.splice(0)) stop();
    await this.runtime.flush();
  }
}

/**
 * OpenTelemetry for the instance (docs/observability.md). Configured by the environment only;
 * while it is off nothing is exported and DomainTelemetry is null. Everyone else injects
 * OBSERVABILITY as optional, so leaving this module out of the composition root is enough to
 * remove it.
 */
@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [
    { provide: TELEMETRY_RUNTIME, useFactory: () => telemetryRuntime() },
    {
      provide: OBSERVABILITY,
      useFactory: (runtime: TelemetryRuntime) =>
        runtime.running && runtime.instruments && runtime.tracer
          ? new DomainTelemetry({ instruments: runtime.instruments, tracer: runtime.tracer })
          : null,
      inject: [TELEMETRY_RUNTIME],
    },
    {
      provide: ObservabilityStatusService,
      useFactory: (runtime: TelemetryRuntime) =>
        new ObservabilityStatusService({ settings: runtime.settings, running: () => runtime.running }),
      inject: [TELEMETRY_RUNTIME],
    },
    ObservabilityRuntime,
  ],
  exports: [OBSERVABILITY],
})
export class ObservabilityModule {}
