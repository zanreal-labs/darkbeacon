import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { requireAccount } from '@darkbeacon/core';
import {
  CharacterActivityQuery,
  nestPath,
  routes,
  UpdateMapTrackingSettingsRequest,
  type CharacterActivityDto,
  type EveServerStatusDto,
  type MapTrackingSettingsDto,
  type MyTrackingDto,
  type OnlineCountsDto,
} from '@darkbeacon/shared';
import { CharacterActivity, MapCharacterSettingsUseCases, ServerStatusWatch } from '@darkbeacon/tracking';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { TrackingOverview } from './my-tracking.js';

/** Characters across maps, my settings on a map, activity, online counts and TQ's status. */
@Controller()
export class CharactersController {
  constructor(
    @Inject(TrackingOverview) private readonly overview: TrackingOverview,
    @Inject(MapCharacterSettingsUseCases) private readonly settings: MapCharacterSettingsUseCases,
    @Inject(CharacterActivity) private readonly activity: CharacterActivity,
    @Inject(ServerStatusWatch) private readonly status: ServerStatusWatch,
  ) {}

  @Get(nestPath(routes.characters.myTracking.path))
  mine(@CurrentActor() actor: Actor | null): Promise<MyTrackingDto> {
    return this.overview.mine(actor);
  }

  @Get(nestPath(routes.characters.onlineCounts.path))
  online(@CurrentActor() actor: Actor | null): Promise<OnlineCountsDto> {
    return this.overview.online(actor);
  }

  @Get(nestPath(routes.characters.mapSettings.path))
  mapSettings(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
  ): Promise<MapTrackingSettingsDto> {
    return this.settings.get(actor, mapId);
  }

  @Put(nestPath(routes.characters.updateMapSettings.path))
  updateMapSettings(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(UpdateMapTrackingSettingsRequest)) body: UpdateMapTrackingSettingsRequest,
  ): Promise<MapTrackingSettingsDto> {
    return this.settings.update(actor, mapId, body);
  }

  @Get(nestPath(routes.characters.activity.path))
  characterActivity(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(CharacterActivityQuery)) query: CharacterActivityQuery,
  ): Promise<CharacterActivityDto[]> {
    return this.activity.list(actor, mapId, query.period);
  }

  @Get(nestPath(routes.characters.eveStatus.path))
  eveStatus(@CurrentActor() actor: Actor | null): EveServerStatusDto {
    requireAccount(actor);
    return this.status.status;
  }
}
