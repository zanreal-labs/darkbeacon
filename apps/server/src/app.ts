import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger, RequestMethod, type LogLevel } from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { installCors } from './platform/cors.js';
import type { PlatformOptions } from './platform/platform.module.js';
import { rewriteVersionedUrl } from './platform/route-index.js';
import { installUpgradeRouting, installWebProxy, type WebUpstream } from './web/web-proxy.js';

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
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, options, web),
    // `/api/v1/...` is the versioned alias of `/api/...` (docs/api.md).
    new FastifyAdapter({
      trustProxy: true,
      rewriteUrl: (req: { url?: string }) => rewriteVersionedUrl(req.url ?? '/'),
    }),
    { logger: options.logger ?? ['log', 'warn', 'error'] },
  );
  // The MCP endpoint lives at /mcp, outside the REST prefix.
  app.setGlobalPrefix('api', { exclude: [{ path: 'mcp', method: RequestMethod.ALL }] });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
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
