import { readFileSync } from 'node:fs';
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InstanceSettingsService } from '@darkbeacon/access';
import type { Actor, Clock, EventLog } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { OBSERVED_ROUTES, TelemetryService } from '@darkbeacon/telemetry';
import { tap, type Observable } from 'rxjs';
import { KyselyTelemetryMetrics } from '../../adapters/telemetry/kysely-telemetry-metrics.js';
import { KyselyTelemetryState } from '../../adapters/telemetry/kysely-telemetry-state.js';
import { hmacSha256, inertSink, PostHogSink } from '../../adapters/telemetry/posthog-sink.js';
import type { AppConfig } from '../../config/config.js';
import { EventLogTaps } from '../../platform/event-taps.js';
import { APP_CONFIG, CLOCK, EVENT_LOG, HTTP_FETCH } from '../../platform/tokens.js';
import { TelemetryController } from './telemetry.controller.js';
import { telemetrySettings } from './telemetry.settings.js';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** The first heartbeat of a new instance waits a little, so a crash loop does not send many. */
const FIRST_CHECK_MS = 60_000;
const ONLINE_SAMPLE_MS = 5 * 60 * 1000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Successful requests on the routes whose use is reported (route computed, signatures pasted...). */
@Injectable()
class TelemetryRequests implements NestInterceptor {
  constructor(@Inject(TelemetryService) private readonly telemetry: TelemetryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.telemetry.active) return next.handle();
    const request = context.switchToHttp().getRequest<{
      method: string;
      routeOptions?: { url?: string };
      query?: unknown;
      body?: unknown;
      actor?: Actor | null;
    }>();
    const path = request.routeOptions?.url ?? '';
    if (!OBSERVED_ROUTES.has(`${request.method} ${path}`)) return next.handle();
    const accountId = request.actor?.kind === 'account' ? request.actor.id : null;
    return next
      .handle()
      .pipe(
        tap((response) =>
          this.telemetry.observeRequest(
            { method: request.method, path, query: request.query, body: request.body, response },
            accountId,
          ),
        ),
      );
  }
}

/** Starts telemetry, feeds it committed events, runs the heartbeat and flushes on shutdown. */
@Injectable()
class TelemetryLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Telemetry');
  private timers: NodeJS.Timeout[] = [];
  private untap: (() => void) | undefined;

  constructor(
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
    @Inject(EventLogTaps) private readonly taps: EventLogTaps,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.telemetry.start();
    this.untap = this.taps.add((events, context) => {
      for (const event of events) this.telemetry.observe(event, context);
    });
    const reason = this.telemetry.offReason;
    if (reason === null) this.logger.log('anonymous telemetry is on (see docs/telemetry.md to opt out)');
    const check = () =>
      void this.telemetry
        .heartbeatIfDue(DAY - HOUR)
        .catch((error: unknown) => this.logger.warn(`heartbeat failed: ${String(error)}`));
    this.timers.push(
      setTimeout(check, FIRST_CHECK_MS).unref(),
      setInterval(check, HOUR).unref(),
      setInterval(() => void this.telemetry.sampleOnline().catch(() => {}), ONLINE_SAMPLE_MS).unref(),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.untap?.();
    await this.telemetry.shutdown(5_000);
  }
}

/**
 * Anonymous product telemetry to the maintainers (docs/telemetry.md). Self-contained: its own
 * environment, tables, routes and lifecycle; dropping this module from the feature list
 * removes it without touching any other.
 */
@Module({
  controllers: [TelemetryController],
  providers: [
    {
      provide: TelemetryService,
      useFactory: (
        config: AppConfig,
        database: Database,
        events: EventLog,
        clock: Clock,
        fetch: Fetch,
        settings: InstanceSettingsService,
      ) => {
        const logger = new Logger('Telemetry');
        const env = telemetrySettings(process.env);
        if (env.problem) logger.warn(env.problem);
        const environment = { key: env.key, env: config.env, optOut: env.optOut };
        // Without a key or with an environment opt-out nothing can ever be sent: no client at all.
        const sink =
          environment.key && environment.optOut === null && config.env === 'production'
            ? new PostHogSink({
                key: environment.key,
                host: env.host,
                fetch,
                clock,
                onError: (error) => logger.warn(`could not send: ${String(error)}`),
              })
            : inertSink;
        return new TelemetryService({
          sink,
          state: new KyselyTelemetryState(database),
          metrics: new KyselyTelemetryMetrics(database, {
            loginMethod: () => settings.loginMethod(),
            eventRetention: async () => (await settings.current()).eventRetentionDays !== null,
          }),
          events,
          clock,
          hmac: hmacSha256,
          config: {
            environment,
            host: env.host,
            appVersion: version,
            demo: config.demoMode,
            nodeMajor: Number(process.versions.node.split('.')[0]),
            discordLogin: config.discord !== null,
            eveSso: config.eve !== null,
          },
          onRejected: (problem) => logger.warn(`dropped an event that is not on the allow-list: ${problem}`),
        });
      },
      inject: [APP_CONFIG, Database, EVENT_LOG, CLOCK, HTTP_FETCH, InstanceSettingsService],
    },
    TelemetryLifecycle,
    { provide: APP_INTERCEPTOR, useClass: TelemetryRequests },
  ],
})
export class TelemetryModule {}
