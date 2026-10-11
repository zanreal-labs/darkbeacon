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
  Put,
  Query,
} from '@nestjs/common';
import type { Actor } from '@wormwright/core';
import {
  ConnectionUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
  UniverseQueries,
} from '@wormwright/mapping';
import {
  AddConnectionRequest,
  AddSignatureRequest,
  AddSystemRequest,
  CreateMapRequest,
  EveId,
  MoveSystemsRequest,
  nestPath,
  PasteSignaturesRequest,
  routes,
  SetLabelsRequest,
  UniverseSearchQuery,
  UpdateConnectionRequest,
  UpdateMapRequest,
  UpdateSignatureRequest,
  UpdateSystemRequest,
} from '@wormwright/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

/** `:solarSystemId` path segment as a number. */
const systemId = new ZodPipe(z.coerce.number().pipe(EveId));

@Controller()
export class MapsController {
  constructor(@Inject(MapUseCases) private readonly maps: MapUseCases) {}

  @Get(nestPath(routes.maps.list.path))
  list(@CurrentActor() actor: Actor | null) {
    return this.maps.list(actor);
  }

  @Post(nestPath(routes.maps.create.path))
  create(@CurrentActor() actor: Actor | null, @Body(new ZodPipe(CreateMapRequest)) body: CreateMapRequest) {
    return this.maps.create(actor, body);
  }

  @Get(nestPath(routes.maps.bySlug.path))
  bySlug(@CurrentActor() actor: Actor | null, @Param('slug') slug: string) {
    return this.maps.getBySlug(actor, slug);
  }

  @Get(nestPath(routes.maps.get.path))
  get(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.maps.get(actor, mapId);
  }

  @Patch(nestPath(routes.maps.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(UpdateMapRequest)) body: UpdateMapRequest,
  ) {
    return this.maps.update(actor, mapId, body);
  }

  @Delete(nestPath(routes.maps.remove.path))
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<void> {
    await this.maps.remove(actor, mapId);
  }

  @Put(nestPath(routes.maps.setLabels.path))
  setLabels(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(SetLabelsRequest)) body: SetLabelsRequest,
  ) {
    return this.maps.setLabels(actor, mapId, body.labels);
  }
}

@Controller()
export class SystemsController {
  constructor(@Inject(SystemUseCases) private readonly systems: SystemUseCases) {}

  @Post(nestPath(routes.systems.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(AddSystemRequest)) body: AddSystemRequest,
  ) {
    return this.systems.add(actor, mapId, body);
  }

  @Post(nestPath(routes.systems.move.path))
  @HttpCode(204)
  async move(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(MoveSystemsRequest)) body: MoveSystemsRequest,
  ): Promise<void> {
    await this.systems.move(actor, mapId, body);
  }

  @Patch(nestPath(routes.systems.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(UpdateSystemRequest)) body: UpdateSystemRequest,
  ) {
    return this.systems.update(actor, mapId, solarSystemId, body);
  }

  @Delete(nestPath(routes.systems.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
  ): Promise<void> {
    await this.systems.remove(actor, mapId, solarSystemId);
  }
}

@Controller()
export class ConnectionsController {
  constructor(@Inject(ConnectionUseCases) private readonly connections: ConnectionUseCases) {}

  @Post(nestPath(routes.connections.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(AddConnectionRequest)) body: AddConnectionRequest,
  ) {
    return this.connections.add(actor, mapId, body);
  }

  @Patch(nestPath(routes.connections.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
    @Body(new ZodPipe(UpdateConnectionRequest)) body: UpdateConnectionRequest,
  ) {
    return this.connections.update(actor, mapId, connectionId, body);
  }

  @Delete(nestPath(routes.connections.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
  ): Promise<void> {
    await this.connections.remove(actor, mapId, connectionId);
  }
}

@Controller()
export class SignaturesController {
  constructor(@Inject(SignatureUseCases) private readonly signatures: SignatureUseCases) {}

  @Get(nestPath(routes.signatures.list.path))
  list(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
  ) {
    return this.signatures.list(actor, mapId, solarSystemId);
  }

  @Post(nestPath(routes.signatures.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(AddSignatureRequest)) body: AddSignatureRequest,
  ) {
    return this.signatures.add(actor, mapId, solarSystemId, body);
  }

  @Post(nestPath(routes.signatures.paste.path))
  @HttpCode(200)
  paste(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(PasteSignaturesRequest)) body: PasteSignaturesRequest,
  ) {
    return this.signatures.paste(actor, mapId, solarSystemId, body);
  }

  @Patch(nestPath(routes.signatures.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('signatureId') signatureId: string,
    @Body(new ZodPipe(UpdateSignatureRequest)) body: UpdateSignatureRequest,
  ) {
    return this.signatures.update(actor, mapId, signatureId, body);
  }

  @Delete(nestPath(routes.signatures.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('signatureId') signatureId: string,
  ): Promise<void> {
    await this.signatures.remove(actor, mapId, signatureId);
  }
}

@Controller()
export class UniverseController {
  constructor(@Inject(UniverseQueries) private readonly universe: UniverseQueries) {}

  @Get(nestPath(routes.universe.searchSystems.path))
  search(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(UniverseSearchQuery)) query: UniverseSearchQuery,
  ) {
    return this.universe.search(actor, query.q, query.limit);
  }

  @Get(nestPath(routes.universe.getSystem.path))
  get(@CurrentActor() actor: Actor | null, @Param('solarSystemId', systemId) solarSystemId: number) {
    return this.universe.get(actor, solarSystemId);
  }
}
