import { Body, Controller, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import type { Actor } from '@wormwright/core';
import { nestPath, routes, SetTrackingRequest, type CharacterPresenceDto } from '@wormwright/shared';
import { ListMapCharacters, SetTracking } from '@wormwright/tracking';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

@Controller()
export class TrackingController {
  constructor(
    @Inject(SetTracking) private readonly setTracking: SetTracking,
    @Inject(ListMapCharacters) private readonly listCharacters: ListMapCharacters,
  ) {}

  @Get(nestPath(routes.tracking.characters.path))
  characters(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
  ): Promise<CharacterPresenceDto[]> {
    return this.listCharacters.execute(actor, mapId);
  }

  @Put(nestPath(routes.tracking.set.path))
  @HttpCode(204)
  async set(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(SetTrackingRequest)) body: SetTrackingRequest,
  ): Promise<void> {
    await this.setTracking.execute(actor, mapId, body);
  }
}
