import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { z } from 'zod';
import {
  ChainPresenceUseCases,
  ClipboardUseCases,
  LinkedMapQueries,
  PingUseCases,
} from '@darkbeacon/mapping';
import {
  ClipboardRolesRequest,
  CreatePingRequest,
  nestPath,
  PasteSystemsRequest,
  routes,
  type ChainPresenceListDto,
  type LinkedMapDto,
  type MapDto,
  type MapPingDto,
  type PasteSystemsResultDto,
} from '@darkbeacon/shared';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const SolarSystemId = z.coerce.number().int().positive();

/**
 * What the canvas does beyond single changes: rally pings, pasting copied systems, the other maps
 * a system is on and when systems were last in the chain.
 */
@Controller()
export class CanvasController {
  constructor(
    @Inject(PingUseCases) private readonly pings: PingUseCases,
    @Inject(ClipboardUseCases) private readonly clipboard: ClipboardUseCases,
    @Inject(LinkedMapQueries) private readonly linked: LinkedMapQueries,
    @Inject(ChainPresenceUseCases) private readonly presence: ChainPresenceUseCases,
  ) {}

  @Get(nestPath(routes.chainPresence.list.path))
  chainPresence(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
  ): Promise<ChainPresenceListDto> {
    return this.presence.list(actor, mapId);
  }

  @Get(nestPath(routes.linkedMaps.elsewhere.path))
  elsewhere(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', new ZodPipe(SolarSystemId)) solarSystemId: number,
  ): Promise<LinkedMapDto[]> {
    return this.linked.elsewhere(actor, mapId, solarSystemId);
  }

  @Get(nestPath(routes.pings.list.path))
  listPings(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<MapPingDto[]> {
    return this.pings.list(actor, mapId);
  }

  @Post(nestPath(routes.pings.create.path))
  createPing(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(CreatePingRequest)) body: CreatePingRequest,
  ): Promise<MapPingDto> {
    return this.pings.create(actor, mapId, body);
  }

  @Delete(nestPath(routes.pings.remove.path))
  @HttpCode(204)
  async removePing(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('pingId') pingId: string,
  ): Promise<void> {
    await this.pings.remove(actor, mapId, pingId);
  }

  @Post(nestPath(routes.clipboard.paste.path))
  @HttpCode(200)
  paste(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(PasteSystemsRequest)) body: PasteSystemsRequest,
  ): Promise<PasteSystemsResultDto> {
    return this.clipboard.paste(actor, mapId, body);
  }

  @Put(nestPath(routes.clipboard.setRoles.path))
  setRoles(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(ClipboardRolesRequest)) body: ClipboardRolesRequest,
  ): Promise<MapDto> {
    return this.clipboard.setRoles(actor, mapId, body);
  }
}
