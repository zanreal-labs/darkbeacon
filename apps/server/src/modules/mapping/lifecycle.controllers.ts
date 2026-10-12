import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { MapUseCases } from '@darkbeacon/mapping';
import { nestPath, routes, TransferMapOwnerRequest, type AdminMapDto, type MapDto } from '@darkbeacon/shared';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

/** Owner handover by the map's owner. */
@Controller()
export class MapLifecycleController {
  constructor(@Inject(MapUseCases) private readonly maps: MapUseCases) {}

  @Put(nestPath(routes.mapLifecycle.transferOwner.path))
  transferOwner(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(TransferMapOwnerRequest)) body: TransferMapOwnerRequest,
  ): Promise<MapDto> {
    return this.maps.transferOwner(actor, mapId, body.accountId);
  }
}

/** The instance admins' map inventory: owners, deleted maps, restore and purge. */
@Controller()
export class AdminMapsController {
  constructor(@Inject(MapUseCases) private readonly maps: MapUseCases) {}

  @Get(nestPath(routes.adminMaps.list.path))
  list(@CurrentActor() actor: Actor | null): Promise<AdminMapDto[]> {
    return this.maps.inventory(actor);
  }

  @Put(nestPath(routes.adminMaps.transferOwner.path))
  transferOwner(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(TransferMapOwnerRequest)) body: TransferMapOwnerRequest,
  ): Promise<MapDto> {
    return this.maps.transferOwner(actor, mapId, body.accountId);
  }

  @Post(nestPath(routes.adminMaps.trash.path))
  @HttpCode(204)
  async trash(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<void> {
    await this.maps.adminTrash(actor, mapId);
  }

  @Post(nestPath(routes.adminMaps.restore.path))
  @HttpCode(200)
  restore(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<MapDto> {
    return this.maps.restore(actor, mapId);
  }

  @Delete(nestPath(routes.adminMaps.purge.path))
  @HttpCode(204)
  async purge(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<void> {
    await this.maps.purge(actor, mapId);
  }
}
