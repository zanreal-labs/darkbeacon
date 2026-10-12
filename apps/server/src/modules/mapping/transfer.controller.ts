import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AccessRules } from '@darkbeacon/access';
import { hasMapRole, type Actor, type MapAccess } from '@darkbeacon/core';
import { MapTransfer, type ImportedMap } from '@darkbeacon/mapping';
import {
  DuplicateMapRequest,
  ImportMapRequest,
  ImportMapSettingsRequest,
  MapExportQuery,
  nestPath,
  routes,
  type ImportMapResultDto,
  type MapDto,
  type MapExportDocument,
} from '@darkbeacon/shared';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { APP_CONFIG, MAP_ACCESS } from '../../platform/tokens.js';

/** The media type for map files over the 1 MB JSON limit (up to `MAP_FILE_LIMIT`). */
export const MAP_FILE_TYPE = 'application/vnd.darkbeacon.map+json';
export const MAP_FILE_LIMIT = 32 * 1024 * 1024;

/**
 * Map files: export and import (`darkbeacon.map` v1), duplicate, settings files. The map part
 * is mapping's `MapTransfer`; the access rules travel through the access module.
 */
@Controller()
export class MapFilesController {
  constructor(
    @Inject(MapTransfer) private readonly transfer: MapTransfer,
    @Inject(AccessRules) private readonly rules: AccessRules,
    @Inject(MAP_ACCESS) private readonly access: MapAccess,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(nestPath(routes.mapFiles.export.path))
  async export(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(MapExportQuery)) query: MapExportQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const content = await this.transfer.exportMap(actor, mapId, { instance: this.config.publicUrl });
    const document: MapExportDocument = query.accessRules
      ? { ...content, accessRules: await this.rules.exportRules(actor, mapId) }
      : content;
    await download(reply, `${content.map.slug}.darkbeacon-map.json`, document);
  }

  @Post(nestPath(routes.mapFiles.import.path))
  async import(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(ImportMapRequest)) body: ImportMapRequest,
  ): Promise<ImportMapResultDto> {
    const { accessRules, ...content } = body.document;
    const imported = await this.transfer.importMap(actor, content, { name: body.name, slug: body.slug });
    const rules =
      body.accessRules && accessRules?.length
        ? await this.rules.importRules(actor, imported.map.id, accessRules)
        : null;
    return result(imported, rules?.added ?? 0);
  }

  @Post(nestPath(routes.mapLifecycle.duplicate.path))
  async duplicate(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(DuplicateMapRequest)) body: DuplicateMapRequest,
  ): Promise<ImportMapResultDto> {
    const imported = await this.transfer.duplicate(actor, mapId, body);
    let added = 0;
    if (body.accessRules && actor && hasMapRole(await this.access.roleOf(actor, mapId), 'admin')) {
      const rules = await this.rules.exportRules(actor, mapId);
      added = (await this.rules.importRules(actor, imported.map.id, rules)).added;
    }
    return result(imported, added);
  }

  @Get(nestPath(routes.mapFiles.exportSettings.path))
  async exportSettings(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const document = await this.transfer.exportSettings(actor, mapId);
    await download(reply, 'map-settings.darkbeacon.json', document);
  }

  @Post(nestPath(routes.mapFiles.importSettings.path))
  @HttpCode(200)
  importSettings(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(ImportMapSettingsRequest)) body: ImportMapSettingsRequest,
  ): Promise<MapDto> {
    return this.transfer.importSettings(actor, mapId, body.document, body.labels);
  }
}

function result(imported: ImportedMap, accessRules: number): ImportMapResultDto {
  return {
    map: { id: imported.map.id, slug: imported.map.slug, name: imported.map.name },
    systems: imported.systems,
    connections: imported.connections,
    signatures: imported.signatures,
    accessRules,
    skippedSystems: imported.skippedSystems,
  };
}

async function download(reply: FastifyReply, file: string, body: unknown): Promise<void> {
  await reply
    .header('content-type', 'application/json; charset=utf-8')
    .header('content-disposition', `attachment; filename="${file.replace(/[^\w.-]+/g, '-')}"`)
    .header('cache-control', 'no-store')
    .send(JSON.stringify(body));
}
