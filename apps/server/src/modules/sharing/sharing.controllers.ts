import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import {
  AcceptShareRequest,
  nestPath,
  OfferShareRequest,
  routes,
  UpdateShareRequest,
} from '@darkbeacon/shared';
import { SharingUseCases } from '@darkbeacon/sharing';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

/** Shares of a map: what it gives (offers, levels, scopes) and what it gets (accept, narrow, hide). */
@Controller()
export class SharesController {
  constructor(@Inject(SharingUseCases) private readonly sharing: SharingUseCases) {}

  @Get(nestPath(routes.sharing.list.path))
  list(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.sharing.list(actor, mapId);
  }

  @Post(nestPath(routes.sharing.offer.path))
  offer(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(OfferShareRequest)) body: OfferShareRequest,
  ) {
    return this.sharing.offer(actor, mapId, body);
  }

  @Patch(nestPath(routes.sharing.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('shareId') shareId: string,
    @Body(new ZodPipe(UpdateShareRequest)) body: UpdateShareRequest,
  ) {
    return this.sharing.update(actor, mapId, shareId, body);
  }

  @Post(nestPath(routes.sharing.accept.path))
  accept(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('shareId') shareId: string,
    @Body(new ZodPipe(AcceptShareRequest)) body: AcceptShareRequest,
  ) {
    return this.sharing.accept(actor, mapId, shareId, body);
  }

  @Delete(nestPath(routes.sharing.revoke.path))
  @HttpCode(204)
  async revoke(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('shareId') shareId: string,
  ): Promise<void> {
    await this.sharing.revoke(actor, mapId, shareId);
  }
}
