import { createReadStream, existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { NotFoundError, ValidationError, type Actor } from '@darkbeacon/core';
import { PluginAdmin, parsePackageSource, pluginRevision } from '@darkbeacon/plugins';
import {
  InstallPluginRequest,
  PluginSettingsQuery,
  SetPluginEnabledRequest,
  UpdatePluginSettingsRequest,
  nestPath,
  routes,
  type CatalogEntryDto,
  type PluginDto,
  type PluginSettingsDto,
  type PluginWebDto,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FilePluginInstaller } from '../../plugins/installer.js';
import { PluginHost } from '../../plugins/plugin-host.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const r = routes.plugins;

/** Raw .tgz request bodies arrive as a Buffer (see the content type parser in PluginsLifecycle). */
export function uploadedPackage(body: unknown): Uint8Array {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ValidationError('Send the .tgz file as the body with content-type application/gzip');
  }
  return body;
}

@Controller()
export class PluginsAdminController {
  constructor(
    @Inject(PluginAdmin) private readonly admin: PluginAdmin,
    @Inject(PluginHost) private readonly host: PluginHost,
  ) {}

  @Get(nestPath(r.list.path))
  list(@CurrentActor() actor: Actor | null): Promise<PluginDto[]> {
    return this.admin.list(actor);
  }

  @Get(nestPath(r.catalog.path))
  catalog(@CurrentActor() actor: Actor | null): Promise<CatalogEntryDto[]> {
    return this.admin.catalog(actor);
  }

  @Post(nestPath(r.install.path))
  install(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(InstallPluginRequest)) body: InstallPluginRequest,
  ): Promise<PluginDto> {
    return this.installed(this.admin.install(actor, parsePackageSource(body.source)));
  }

  @Post(nestPath(r.upload.path))
  upload(@CurrentActor() actor: Actor | null, @Body() body: unknown): Promise<PluginDto> {
    return this.installed(this.admin.install(actor, { kind: 'upload', data: uploadedPackage(body) }));
  }

  @Put(nestPath(r.setEnabled.path))
  async setEnabled(
    @CurrentActor() actor: Actor | null,
    @Param('pluginId') pluginId: string,
    @Body(new ZodPipe(SetPluginEnabledRequest)) body: SetPluginEnabledRequest,
  ): Promise<PluginDto> {
    const plugin = await this.admin.setEnabled(actor, pluginId, body.enabled, body.mapId);
    await this.host.sync(pluginId);
    return plugin;
  }

  @Delete(nestPath(r.uninstall.path))
  @HttpCode(204)
  async uninstall(@CurrentActor() actor: Actor | null, @Param('pluginId') pluginId: string): Promise<void> {
    await this.admin.uninstall(actor, pluginId);
    await this.host.sync(pluginId);
  }

  @Get(nestPath(r.settings.path))
  settings(
    @CurrentActor() actor: Actor | null,
    @Param('pluginId') pluginId: string,
    @Query(new ZodPipe(PluginSettingsQuery)) query: PluginSettingsQuery,
  ): Promise<PluginSettingsDto> {
    return this.admin.getSettings(actor, pluginId, query.mapId);
  }

  @Put(nestPath(r.updateSettings.path))
  updateSettings(
    @CurrentActor() actor: Actor | null,
    @Param('pluginId') pluginId: string,
    @Body(new ZodPipe(UpdatePluginSettingsRequest)) body: UpdatePluginSettingsRequest,
  ): Promise<PluginSettingsDto> {
    return this.admin.updateSettings(actor, pluginId, body.values, body.mapId);
  }

  /** Loads (or reloads, on an upgrade) the plugin before answering. */
  private async installed(install: Promise<PluginDto>): Promise<PluginDto> {
    const plugin = await install;
    await this.host.sync(plugin.id);
    return plugin;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** What the SPA talks to: the web loader list, web part files, and plugin routes. */
@Controller()
export class PluginRuntimeController {
  constructor(
    @Inject(PluginAdmin) private readonly admin: PluginAdmin,
    @Inject(PluginHost) private readonly host: PluginHost,
    @Inject(FilePluginInstaller) private readonly installer: FilePluginInstaller,
  ) {}

  @Get(nestPath(r.web.path))
  async web(@CurrentActor() actor: Actor | null): Promise<PluginWebDto[]> {
    return (await this.admin.webPlugins(actor)).map((p) => ({
      id: p.id,
      url: `/api/plugins/${p.id}/assets/${basename(p.manifest.web!)}?rev=${encodeURIComponent(pluginRevision(p))}`,
      disabledMapIds: p.disabledMapIds,
    }));
  }

  /** Files next to the web entry, so a bundle can import its own chunks relatively. */
  @Get(nestPath(r.asset.path))
  async asset(
    @CurrentActor() actor: Actor | null,
    @Param('pluginId') pluginId: string,
    @Param('file') file: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const plugin = (await this.admin.webPlugins(actor)).find((p) => p.id === pluginId);
    if (!plugin?.manifest.web || !/^[\w-][\w.-]*$/.test(file)) throw new NotFoundError('File');
    const path = join(this.installer.pluginDir(plugin.id), dirname(plugin.manifest.web), file);
    if (!existsSync(path)) throw new NotFoundError('File');
    await reply
      .header('content-type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(path));
  }

  @All('plugins/:pluginId/*')
  async route(
    @CurrentActor() actor: Actor | null,
    @Param('pluginId') pluginId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Open to anonymous callers: the plugin sees `accountId: null` (and its map role) and decides.
    const prefix = `/api/plugins/${pluginId}`;
    const path = (request.url.split('?')[0] ?? '').slice(prefix.length) || '/';
    const response = await this.host.handleHttp(pluginId, request.method, path, actor, {
      query: request.query as Record<string, string>,
      body: request.body,
    });
    if (!response) throw new NotFoundError('Route');
    await reply
      .status(response.status ?? 200)
      .headers(response.headers ?? {})
      .send(response.body ?? null);
  }
}
