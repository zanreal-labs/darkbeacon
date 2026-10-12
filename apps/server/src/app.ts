import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger, RequestMethod, type LogLevel } from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { installCors } from './platform/cors.js';
import { installMaintenanceGate, MaintenanceMode } from './platform/maintenance.js';
import type { PlatformOptions } from './platform/platform.module.js';
import { rewriteVersionedUrl } from './platform/route-index.js';
import { OtelBridgeLogger } from './adapters/observability/otel-logger.js';
import { telemetryRuntime } from './adapters/observability/runtime.js';
import {
  WELL_KNOWN_PATHS,
  installUpgradeRouting,
  installWebProxy,
  type WebUpstream,
} from './web/web-proxy.js';

export interface CreateAppOptions extends PlatformOptions {
  logger?: false | LogLevel[];
  /**
   * The web app's server; every request outside /api and /ws is proxied to it. Without one
   * (tests, API-only) only the API is served. A `stop()` is called on shutdown.
   */
  web?: (WebUpstream & { stop?(): Promise<void> }) | null;
}

const ROUTES = new WeakMap<NestFastifyApplication, Array<{ method: string; url: string }>>();

/** Every HTTP route the app registered (method and Fastify pattern), for contract tests. */
export function registeredRoutes(
  app: NestFastifyApplication,
): ReadonlyArray<{ method: string; url: string }> {
  return ROUTES.get(app) ?? [];
}

/** Builds the whole server (REST under /api, WebSocket at /ws, the web app behind it) without listening. */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const web = options.web ?? null;
  const levels: LogLevel[] = ['log', 'warn', 'error'];
  // With logs going out over OpenTelemetry, every line is also a log record tied to its trace.
  const appLogger =
    options.logger ?? (telemetryRuntime().logs ? new OtelBridgeLogger({ logLevels: levels }) : levels);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, options, web),
    // `/api/v1/...` is the versioned alias of `/api/...` (docs/api.md).
    new FastifyAdapter({
      trustProxy: true,
      rewriteUrl: (req: { url?: string }) => rewriteVersionedUrl(req.url ?? '/'),
    }),
    { logger: appLogger },
  );
  // The MCP endpoint lives at /mcp and the OAuth metadata under /.well-known, outside the REST prefix.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'mcp', method: RequestMethod.ALL },
      ...WELL_KNOWN_PATHS.map((path) => ({ path: path.slice(1), method: RequestMethod.GET })),
    ],
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  // Before the web proxy: in maintenance, page loads are answered here.
  installMaintenanceGate(app, app.get(MaintenanceMode));
  const logger = new Logger('Web');
  installWebProxy(app, web, (error) => logger.warn(`web server did not answer: ${error.message}`));
  const seen: Array<{ method: string; url: string }> = [];
  ROUTES.set(app, seen);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) seen.push({ method: String(method), url: route.url });
    });
  const settings = app.get(InstanceSettingsService);
  installCors(app, config.publicUrl, async () => (await settings.current()).apiCorsOrigins ?? []);
  await app.init();
  installUpgradeRouting(app.getHttpServer(), web);
  return app;
}
