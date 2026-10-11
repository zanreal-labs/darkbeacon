import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import type { LogLevel } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import type { PlatformOptions } from './platform/platform.module.js';
import { serveWebApp } from './web/static.js';

export interface CreateAppOptions extends PlatformOptions {
  logger?: false | LogLevel[];
  /** Directory of the built web app; defaults to apps/web/dist. */
  webDist?: string;
}

/** Builds the whole server (REST under /api, WebSocket at /ws, static web app) without listening. */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, options),
    new FastifyAdapter({ trustProxy: true }),
    { logger: options.logger ?? ['log', 'warn', 'error'] },
  );
  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  await serveWebApp(app, options.webDist);
  await app.init();
  return app;
}
