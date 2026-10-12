import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { CommentUseCases, StructureUseCases } from '@darkbeacon/mapping';
import {
  AddCommentRequest,
  AddStructureRequest,
  EveId,
  nestPath,
  PasteStructuresRequest,
  routes,
  SetStructureOwnersRequest,
  UpdateStructureRequest,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

const systemId = new ZodPipe(z.coerce.number().pipe(EveId));

/** Comment threads on the systems of a map. */
@Controller()
export class CommentsController {
  constructor(@Inject(CommentUseCases) private readonly comments: CommentUseCases) {}

  @Get(nestPath(routes.comments.list.path))
  list(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
  ) {
    return this.comments.list(actor, mapId, solarSystemId);
  }

  @Post(nestPath(routes.comments.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(AddCommentRequest)) body: AddCommentRequest,
  ) {
    return this.comments.add(actor, mapId, solarSystemId, body);
  }

  @Delete(nestPath(routes.comments.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('commentId') commentId: string,
  ): Promise<void> {
    await this.comments.remove(actor, mapId, commentId);
  }
}

/** Structures in the systems of a map. */
@Controller()
export class StructuresController {
  constructor(@Inject(StructureUseCases) private readonly structures: StructureUseCases) {}

  @Get(nestPath(routes.structures.listMap.path))
  listMap(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.structures.listMap(actor, mapId);
  }

  @Get(nestPath(routes.structures.list.path))
  list(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
  ) {
    return this.structures.list(actor, mapId, solarSystemId);
  }

  @Post(nestPath(routes.structures.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(AddStructureRequest)) body: AddStructureRequest,
  ) {
    return this.structures.add(actor, mapId, solarSystemId, body);
  }

  @Post(nestPath(routes.structures.paste.path))
  @HttpCode(200)
  paste(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(PasteStructuresRequest)) body: PasteStructuresRequest,
  ) {
    return this.structures.paste(actor, mapId, solarSystemId, body.text);
  }

  @Put(nestPath(routes.structures.setOwners.path))
  setOwners(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(SetStructureOwnersRequest)) body: SetStructureOwnersRequest,
  ) {
    return this.structures.setOwners(actor, mapId, solarSystemId, body.owner);
  }

  @Patch(nestPath(routes.structures.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('structureId') structureId: string,
    @Body(new ZodPipe(UpdateStructureRequest)) body: UpdateStructureRequest,
  ) {
    return this.structures.update(actor, mapId, structureId, body);
  }

  @Delete(nestPath(routes.structures.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('structureId') structureId: string,
  ): Promise<void> {
    await this.structures.remove(actor, mapId, structureId);
  }
}
