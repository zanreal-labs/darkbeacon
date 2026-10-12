import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import {
  AcceptShareRequest,
  AddConnectionRequest,
  AddSignatureRequest,
  AddSystemRequest,
  EveId,
  MoveSystemsRequest,
  nestPath,
  OfferShareRequest,
  PasteSignaturesRequest,
  routes,
  UpdateConnectionRequest,
  UpdateShareRequest,
  UpdateSignatureRequest,
  UpdateSystemRequest,
} from '@darkbeacon/shared';
import { ChainWrites, SharingUseCases } from '@darkbeacon/sharing';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const systemId = new ZodPipe(z.coerce.number().pipe(EveId));

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

/** Changes on a map that merges others, written through to its sources (results arrive as events). */
@Controller()
export class ChainController {
  constructor(@Inject(ChainWrites) private readonly writes: ChainWrites) {}

  @Post(nestPath(routes.chain.addSystem.path))
  @HttpCode(204)
  async addSystem(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(AddSystemRequest)) body: AddSystemRequest,
  ): Promise<void> {
    await this.writes.addSystem(actor, mapId, body);
  }

  @Post(nestPath(routes.chain.moveSystems.path))
  @HttpCode(204)
  async move(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(MoveSystemsRequest)) body: MoveSystemsRequest,
  ): Promise<void> {
    await this.writes.moveSystems(actor, mapId, body);
  }

  @Patch(nestPath(routes.chain.updateSystem.path))
  @HttpCode(204)
  async updateSystem(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(UpdateSystemRequest)) body: UpdateSystemRequest,
  ): Promise<void> {
    await this.writes.updateSystem(actor, mapId, solarSystemId, body);
  }

  @Delete(nestPath(routes.chain.removeSystem.path))
  @HttpCode(204)
  async removeSystem(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
  ): Promise<void> {
    await this.writes.removeSystem(actor, mapId, solarSystemId);
  }

  @Post(nestPath(routes.chain.addConnection.path))
  @HttpCode(204)
  async addConnection(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(AddConnectionRequest)) body: AddConnectionRequest,
  ): Promise<void> {
    await this.writes.addConnection(actor, mapId, body);
  }

  @Patch(nestPath(routes.chain.updateConnection.path))
  @HttpCode(204)
  async updateConnection(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
    @Body(new ZodPipe(UpdateConnectionRequest)) body: UpdateConnectionRequest,
  ): Promise<void> {
    await this.writes.updateConnection(actor, mapId, connectionId, body);
  }

  @Delete(nestPath(routes.chain.removeConnection.path))
  @HttpCode(204)
  async removeConnection(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
  ): Promise<void> {
    await this.writes.removeConnection(actor, mapId, connectionId);
  }

  @Post(nestPath(routes.chain.addSignature.path))
  @HttpCode(204)
  async addSignature(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(AddSignatureRequest)) body: AddSignatureRequest,
  ): Promise<void> {
    await this.writes.addSignature(actor, mapId, solarSystemId, body);
  }

  @Post(nestPath(routes.chain.pasteSignatures.path))
  @HttpCode(200)
  paste(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(PasteSignaturesRequest)) body: PasteSignaturesRequest,
  ) {
    return this.writes.pasteSignatures(actor, mapId, solarSystemId, body);
  }

  @Patch(nestPath(routes.chain.updateSignature.path))
  @HttpCode(204)
  async updateSignature(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('signatureId') signatureId: string,
    @Body(new ZodPipe(UpdateSignatureRequest)) body: UpdateSignatureRequest,
  ): Promise<void> {
    await this.writes.updateSignature(actor, mapId, signatureId, body);
  }

  @Delete(nestPath(routes.chain.removeSignature.path))
  @HttpCode(204)
  async removeSignature(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('signatureId') signatureId: string,
  ): Promise<void> {
    await this.writes.removeSignature(actor, mapId, signatureId);
  }
}
