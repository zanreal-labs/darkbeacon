import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import {
  nestPath,
  routes,
  SetTelemetryEnabledRequest,
  TelemetryIngestRequest,
  type TelemetryClientDto,
  type TelemetryIngestResultDto,
  type TelemetryStatusDto,
} from '@darkbeacon/shared';
import { TelemetryService } from '@darkbeacon/telemetry';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

@Controller()
export class TelemetryController {
  constructor(@Inject(TelemetryService) private readonly telemetry: TelemetryService) {}

  @Get(nestPath(routes.telemetry.client.path))
  client(@CurrentActor() actor: Actor | null): Promise<TelemetryClientDto> {
    return this.telemetry.client(actor);
  }

  @Post(nestPath(routes.telemetry.ingest.path))
  @HttpCode(202)
  ingest(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(TelemetryIngestRequest)) body: TelemetryIngestRequest,
  ): TelemetryIngestResultDto {
    return this.telemetry.ingest(actor, body);
  }

  @Get(nestPath(routes.telemetry.status.path))
  status(@CurrentActor() actor: Actor | null): Promise<TelemetryStatusDto> {
    return this.telemetry.status(actor);
  }

  @Put(nestPath(routes.telemetry.setEnabled.path))
  setEnabled(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SetTelemetryEnabledRequest)) body: SetTelemetryEnabledRequest,
  ): Promise<TelemetryStatusDto> {
    return this.telemetry.setEnabled(actor, body.enabled);
  }

  @Post(nestPath(routes.telemetry.dismissNotice.path))
  @HttpCode(204)
  async dismissNotice(@CurrentActor() actor: Actor | null): Promise<void> {
    await this.telemetry.dismissNotice(actor);
  }
}
