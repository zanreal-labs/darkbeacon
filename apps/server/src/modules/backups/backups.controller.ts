import { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { BackupService } from '@darkbeacon/backups';
import { requireInstanceRole, type Actor } from '@darkbeacon/core';
import {
  nestPath,
  RestoreBackupRequest,
  routes,
  UpdateBackupSettingsRequest,
  type BackupDto,
  type BackupSettingsDto,
  type BackupStatusDto,
  type RestoreResultDto,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { receiveUpload } from '../../adapters/backups/multipart-upload.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { BACKUP_CONFIG, type BackupModuleConfig } from './backups.tokens.js';

const r = routes.backups;

@Controller()
export class BackupsController {
  constructor(
    @Inject(BackupService) private readonly backups: BackupService,
    @Inject(BACKUP_CONFIG) private readonly config: BackupModuleConfig,
  ) {}

  @Get(nestPath(r.status.path))
  status(@CurrentActor() actor: Actor | null): Promise<BackupStatusDto> {
    return this.backups.status(actor);
  }

  @Post(nestPath(r.create.path))
  create(@CurrentActor() actor: Actor | null): Promise<BackupDto> {
    return this.backups.create(actor);
  }

  @Patch(nestPath(r.updateSettings.path))
  updateSettings(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(UpdateBackupSettingsRequest)) body: UpdateBackupSettingsRequest,
  ): Promise<BackupSettingsDto> {
    return this.backups.updateSettings(actor, body);
  }

  @Get(nestPath(r.download.path))
  async download(
    @CurrentActor() actor: Actor | null,
    @Param('name') name: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { manifest, stream } = await this.backups.download(actor, name);
    await reply
      .header('content-type', 'application/gzip')
      .header('content-length', String(manifest.size))
      .header('content-disposition', `attachment; filename="${manifest.name}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(stream instanceof Readable ? stream : Readable.from(stream));
  }

  @Delete(nestPath(r.remove.path))
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor | null, @Param('name') name: string): Promise<void> {
    await this.backups.remove(actor, name);
  }

  @Post(nestPath(r.restoreUpload.path))
  async restoreUpload(
    @CurrentActor() actor: Actor | null,
    @Req() request: FastifyRequest,
  ): Promise<RestoreResultDto> {
    // Refused before a single byte is written to disk.
    requireInstanceRole(actor, 'admin');
    const upload = await receiveUpload(request.raw, this.config.scratchDir, this.config.maxUploadBytes);
    return this.backups.restoreUpload(actor, upload.file, upload.fields.confirm);
  }

  @Post(nestPath(r.restore.path))
  restore(
    @CurrentActor() actor: Actor | null,
    @Param('name') name: string,
    @Body() body: unknown,
  ): Promise<RestoreResultDto> {
    const parsed = RestoreBackupRequest.safeParse(body);
    return this.backups.restore(actor, name, parsed.success ? parsed.data.confirm : undefined);
  }
}
