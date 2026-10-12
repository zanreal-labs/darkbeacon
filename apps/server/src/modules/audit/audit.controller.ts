import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { AuditTrail, toCsv } from '@darkbeacon/audit';
import type { Actor } from '@darkbeacon/core';
import {
  AuditExportQuery,
  AuditQuery,
  nestPath,
  routes,
  UndoActionRequest,
  type UndoResultDto,
  type AuditEntryDto,
  type AuditPageDto,
  type AuditRevertDto,
  type AuditVerifyDto,
} from '@darkbeacon/shared';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const r = routes.audit;
const SolarSystemId = z.coerce.number().int().positive();

@Controller()
export class AuditController {
  constructor(@Inject(AuditTrail) private readonly trail: AuditTrail) {}

  @Get(nestPath(r.mapHistory.path))
  mapHistory(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(AuditQuery)) query: AuditQuery,
  ): Promise<AuditPageDto> {
    return this.trail.mapHistory(actor, mapId, query);
  }

  @Get(nestPath(r.systemHistory.path))
  systemHistory(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', new ZodPipe(SolarSystemId)) solarSystemId: number,
    @Query(new ZodPipe(AuditQuery)) query: AuditQuery,
  ): Promise<AuditPageDto> {
    return this.trail.mapHistory(actor, mapId, query, { solarSystemId });
  }

  @Get(nestPath(r.connectionHistory.path))
  connectionHistory(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
    @Query(new ZodPipe(AuditQuery)) query: AuditQuery,
  ): Promise<AuditPageDto> {
    return this.trail.mapHistory(actor, mapId, query, { connectionId });
  }

  @Get(nestPath(r.mapExport.path))
  async mapExport(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(AuditExportQuery)) query: AuditExportQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await send(reply, `map-history-${mapId}`, query.format, await this.trail.mapExport(actor, mapId, query));
  }

  @Post(nestPath(r.revert.path))
  @HttpCode(200)
  revert(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('eventId') eventId: string,
  ): Promise<AuditRevertDto> {
    return this.trail.revert(actor, mapId, eventId);
  }

  @Post(nestPath(routes.undo.action.path))
  @HttpCode(200)
  undo(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(UndoActionRequest)) body: UndoActionRequest,
  ): Promise<UndoResultDto> {
    return this.trail.undo(actor, mapId, body.action);
  }

  @Get(nestPath(r.instance.path))
  instance(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(AuditQuery)) query: AuditQuery,
  ): Promise<AuditPageDto> {
    return this.trail.instanceAudit(actor, query);
  }

  @Get(nestPath(r.instanceExport.path))
  async instanceExport(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(AuditExportQuery)) query: AuditExportQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await send(reply, 'instance-audit', query.format, await this.trail.instanceExport(actor, query));
  }

  @Post(nestPath(r.verify.path))
  @HttpCode(200)
  verify(@CurrentActor() actor: Actor | null): Promise<AuditVerifyDto> {
    return this.trail.verify(actor);
  }
}

/** A download: CSV (spreadsheets) or JSON (an array of AuditEntryDto). */
async function send(
  reply: FastifyReply,
  name: string,
  format: 'csv' | 'json',
  entries: AuditEntryDto[],
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const file = `${name.replace(/[^\w.-]+/g, '-')}-${date}.${format}`;
  await reply
    .header('content-type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
    .header('content-disposition', `attachment; filename="${file}"`)
    .header('cache-control', 'no-store')
    .send(format === 'csv' ? toCsv(entries) : JSON.stringify(entries));
}
