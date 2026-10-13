import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ValidationError, type Actor } from '@darkbeacon/core';
import { ImportService } from '@darkbeacon/importing';
import {
  ImportPlanRequest,
  nestPath,
  routes,
  StartImportRequest,
  WandererApiSourceRequest,
  WandererDbConnectRequest,
  WandererDbSourceRequest,
  type WandererDbMapsDto,
  type ImportJobDto,
  type ImportPlanDto,
  type ImportSyncDto,
  type WandererTestResultDto,
} from '@darkbeacon/shared';
import type { FastifyReply } from 'fastify';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { UploadedExport } from './export-upload.js';

const r = routes.imports;

@Controller()
export class ImportsController {
  constructor(@Inject(ImportService) private readonly imports: ImportService) {}

  @Post(nestPath(r.test.path))
  @HttpCode(200)
  test(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(WandererApiSourceRequest)) body: WandererApiSourceRequest,
  ): Promise<WandererTestResultDto> {
    return this.imports.test(actor, body);
  }

  @Post(nestPath(r.previewApi.path))
  previewApi(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(WandererApiSourceRequest)) body: WandererApiSourceRequest,
  ): Promise<ImportJobDto> {
    return this.imports.previewApi(actor, body);
  }

  @Post(nestPath(r.dbMaps.path))
  @HttpCode(200)
  dbMaps(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(WandererDbConnectRequest)) body: WandererDbConnectRequest,
  ): Promise<WandererDbMapsDto> {
    return this.imports.dbMaps(actor, body);
  }

  @Post(nestPath(r.previewDb.path))
  previewDb(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(WandererDbSourceRequest)) body: WandererDbSourceRequest,
  ): Promise<ImportJobDto> {
    return this.imports.previewDb(actor, body);
  }

  @Post(nestPath(r.previewFile.path))
  previewFile(
    @CurrentActor() actor: Actor | null,
    @Body() body: unknown,
    @Query('name') name: string | undefined,
  ): Promise<ImportJobDto> {
    if (!(body instanceof UploadedExport))
      throw new ValidationError('Send the Wanderer export file as the request body (see the import page)');
    if (body.error) throw new ValidationError(body.error);
    return this.imports.previewFile(actor, body.document, name?.slice(0, 200) ?? null);
  }

  @Get(nestPath(r.get.path))
  get(@CurrentActor() actor: Actor | null, @Param('jobId') jobId: string): Promise<ImportJobDto> {
    return this.imports.get(actor, jobId);
  }

  @Post(nestPath(r.plan.path))
  @HttpCode(200)
  plan(
    @CurrentActor() actor: Actor | null,
    @Param('jobId') jobId: string,
    @Body(new ZodPipe(ImportPlanRequest)) body: ImportPlanRequest,
  ): Promise<ImportPlanDto> {
    return this.imports.plan(actor, jobId, body);
  }

  @Post(nestPath(r.start.path))
  @HttpCode(200)
  start(
    @CurrentActor() actor: Actor | null,
    @Param('jobId') jobId: string,
    @Body(new ZodPipe(StartImportRequest)) body: StartImportRequest,
  ): Promise<ImportJobDto> {
    return this.imports.start(actor, jobId, body);
  }

  @Post(nestPath(r.cancel.path))
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor | null, @Param('jobId') jobId: string): Promise<ImportJobDto> {
    return this.imports.cancel(actor, jobId);
  }

  @Get(nestPath(r.report.path))
  async report(
    @CurrentActor() actor: Actor | null,
    @Param('jobId') jobId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const report = await this.imports.report(actor, jobId);
    const job = report.job as ImportJobDto;
    const name = `darkbeacon-import-${job.source.slug.replace(/[^a-z0-9-]+/gi, '-')}-${job.id.slice(0, 8)}.json`;
    await reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(JSON.stringify(report, null, 2));
  }

  @Get(nestPath(r.sync.path))
  sync(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<ImportSyncDto | null> {
    return this.imports.sync(actor, mapId);
  }

  @Delete(nestPath(r.stopSync.path))
  @HttpCode(204)
  async stopSync(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<void> {
    await this.imports.stopSync(actor, mapId);
  }
}
