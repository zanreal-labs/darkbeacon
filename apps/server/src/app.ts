import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger, type LogLevel } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { installMaintenanceGate, MaintenanceMode } from './platform/maintenance.js';
import type { PlatformOptions } from './platform/platform.module.js';
import { OtelBridgeLogger } from './adapters/observability/otel-logger.js';
import { telemetryRuntime } from './adapters/observability/runtime.js';
import { installUpgradeRouting, installWebProxy, type WebUpstream } from './web/web-proxy.js';

export interface CreateAppOptions extends PlatformOptions {
  logger?: false | LogLevel[];
  /**
   * The web app's server; every request outside /api and /ws is proxied to it. Without one
   * (tests, API-only) only the API is served. A `stop()` is called on shutdown.
   */
  web?: (WebUpstream & { stop?(): Promise<void> }) | null;
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
    new FastifyAdapter({ trustProxy: true }),
    { logger: appLogger },
  );
  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  // Before the web proxy: in maintenance, page loads are answered here.
  installMaintenanceGate(app, app.get(MaintenanceMode));
  const logger = new Logger('Web');
  installWebProxy(app, web, (error) => logger.warn(`web server did not answer: ${error.message}`));
  await app.init();
  installUpgradeRouting(app.getHttpServer(), web);
  return app;
}
