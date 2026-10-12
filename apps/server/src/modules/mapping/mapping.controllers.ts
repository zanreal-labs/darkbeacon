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
import type { Actor } from '@darkbeacon/core';
import {
  BookmarkNumberUseCases,
  ConnectionIntelQuery,
  ConnectionUseCases,
  MapPreferenceUseCases,
  MapUseCases,
  SignatureUseCases,
  SystemUseCases,
} from '@darkbeacon/mapping';
import {
  AddConnectionRequest,
  AddSignatureRequest,
  AddSystemRequest,
  CreateMapRequest,
  EveId,
  MoveSystemsRequest,
  nestPath,
  PasteSignaturesRequest,
  RemoveSignaturesRequest,
  RenumberBookmarksRequest,
  RestoreSignaturesRequest,
  routes,
  SetBookmarkNumberingRequest,
  SetBookmarkNumberRequest,
  SetBookmarkTemplateRequest,
  SetLabelsRequest,
  UpdateConnectionRequest,
  UpdateMapPreferencesRequest,
  UpdateMapRequest,
  UpdateSignatureRequest,
  UpdateSystemRequest,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { MergedWriteRouter } from './merged-writes.js';

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

  @Put(nestPath(routes.maps.setBookmarkTemplate.path))
  setBookmarkTemplate(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(SetBookmarkTemplateRequest)) body: SetBookmarkTemplateRequest,
  ) {
    return this.maps.setBookmarkTemplate(actor, mapId, body.template);
  }

  @Put(nestPath(routes.maps.setBookmarkNumbering.path))
  setBookmarkNumbering(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(SetBookmarkNumberingRequest)) body: SetBookmarkNumberingRequest,
  ) {
    return this.maps.setBookmarkNumbering(actor, mapId, body.numbering);
  }
}

/** `{n}` of wormholes: renumbering on request and numbers set by hand. */
@Controller()
export class BookmarkNumbersController {
  constructor(@Inject(BookmarkNumberUseCases) private readonly numbers: BookmarkNumberUseCases) {}

  @Post(nestPath(routes.maps.renumberBookmarks.path))
  @HttpCode(204)
  async renumber(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(RenumberBookmarksRequest)) body: RenumberBookmarksRequest,
  ): Promise<void> {
    await this.numbers.renumber(actor, mapId, body.parent);
  }

  @Put(nestPath(routes.connections.setBookmarkNumber.path))
  setNumber(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
    @Body(new ZodPipe(SetBookmarkNumberRequest)) body: SetBookmarkNumberRequest,
  ) {
    return this.numbers.setNumber(actor, mapId, connectionId, body.number);
  }
}

/** The caller's own view of a map. */
@Controller()
export class MapPreferencesController {
  constructor(@Inject(MapPreferenceUseCases) private readonly preferences: MapPreferenceUseCases) {}

  @Get(nestPath(routes.maps.getPreferences.path))
  get(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.preferences.get(actor, mapId);
  }

  @Patch(nestPath(routes.maps.updatePreferences.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(UpdateMapPreferencesRequest)) body: UpdateMapPreferencesRequest,
  ) {
    return this.preferences.update(actor, mapId, body);
  }
}

@Controller()
export class SystemsController {
  constructor(
    @Inject(SystemUseCases) private readonly systems: SystemUseCases,
    @Inject(MergedWriteRouter) private readonly merged: MergedWriteRouter,
  ) {}

  @Post(nestPath(routes.systems.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(AddSystemRequest)) body: AddSystemRequest,
  ) {
    return this.merged.route(
      mapId,
      (w) => w.addSystem(actor, mapId, body),
      () => this.systems.add(actor, mapId, body),
    );
  }

  @Post(nestPath(routes.systems.move.path))
  @HttpCode(204)
  async move(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(MoveSystemsRequest)) body: MoveSystemsRequest,
  ): Promise<void> {
    await this.merged.route(
      mapId,
      (w) => w.moveSystems(actor, mapId, body),
      () => this.systems.move(actor, mapId, body),
    );
  }

  @Patch(nestPath(routes.systems.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(UpdateSystemRequest)) body: UpdateSystemRequest,
  ) {
    return this.merged.route(
      mapId,
      (w) => w.updateSystem(actor, mapId, solarSystemId, body),
      () => this.systems.update(actor, mapId, solarSystemId, body),
    );
  }

  @Delete(nestPath(routes.systems.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
  ): Promise<void> {
    await this.merged.route(
      mapId,
      (w) => w.removeSystem(actor, mapId, solarSystemId),
      () => this.systems.remove(actor, mapId, solarSystemId),
    );
  }
}

@Controller()
export class ConnectionsController {
  constructor(
    @Inject(ConnectionUseCases) private readonly connections: ConnectionUseCases,
    @Inject(ConnectionIntelQuery) private readonly intel: ConnectionIntelQuery,
    @Inject(MergedWriteRouter) private readonly merged: MergedWriteRouter,
  ) {}

  @Get(nestPath(routes.connections.intel.path))
  list(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.intel.list(actor, mapId);
  }

  @Get(nestPath(routes.connections.passages.path))
  passages(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.intel.passages(actor, mapId, connectionId);
  }

  @Post(nestPath(routes.connections.add.path))
  add(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(AddConnectionRequest)) body: AddConnectionRequest,
  ) {
    return this.merged.route(
      mapId,
      (w) => w.addConnection(actor, mapId, body),
      () => this.connections.add(actor, mapId, body),
    );
  }

  @Patch(nestPath(routes.connections.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
    @Body(new ZodPipe(UpdateConnectionRequest)) body: UpdateConnectionRequest,
  ) {
    return this.merged.route(
      mapId,
      (w) => w.updateConnection(actor, mapId, connectionId, body),
      () => this.connections.update(actor, mapId, connectionId, body),
    );
  }

  @Delete(nestPath(routes.connections.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('connectionId') connectionId: string,
    // `?withSignatures=true`: the signatures leading through it go too.
    @Query('withSignatures') withSignatures?: string,
  ): Promise<void> {
    await this.merged.route(
      mapId,
      (w) => w.removeConnection(actor, mapId, connectionId),
      () =>
        this.connections.remove(actor, mapId, connectionId, { withSignatures: withSignatures === 'true' }),
    );
  }
}

@Controller()
export class SignaturesController {
  constructor(
    @Inject(SignatureUseCases) private readonly signatures: SignatureUseCases,
    @Inject(MergedWriteRouter) private readonly merged: MergedWriteRouter,
  ) {}

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
    return this.merged.route(
      mapId,
      (w) => w.addSignature(actor, mapId, solarSystemId, body),
      () => this.signatures.add(actor, mapId, solarSystemId, body),
    );
  }

  @Post(nestPath(routes.signatures.paste.path))
  @HttpCode(200)
  paste(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(PasteSignaturesRequest)) body: PasteSignaturesRequest,
  ) {
    return this.merged.route(
      mapId,
      (w) => w.pasteSignatures(actor, mapId, solarSystemId, body),
      () => this.signatures.paste(actor, mapId, solarSystemId, body),
    );
  }

  @Patch(nestPath(routes.signatures.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('signatureId') signatureId: string,
    @Body(new ZodPipe(UpdateSignatureRequest)) body: UpdateSignatureRequest,
  ) {
    return this.merged.route(
      mapId,
      (w) => w.updateSignature(actor, mapId, signatureId, body),
      () => this.signatures.update(actor, mapId, signatureId, body),
    );
  }

  @Delete(nestPath(routes.signatures.remove.path))
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('signatureId') signatureId: string,
  ): Promise<void> {
    await this.merged.route(
      mapId,
      (w) => w.removeSignature(actor, mapId, signatureId),
      () => this.signatures.remove(actor, mapId, signatureId),
    );
  }

  /** On a merged map each one is removed through its sources, without cascades or an undo. */
  @Post(nestPath(routes.signatures.removeMany.path))
  @HttpCode(200)
  async removeMany(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('solarSystemId', systemId) solarSystemId: number,
    @Body(new ZodPipe(RemoveSignaturesRequest)) body: RemoveSignaturesRequest,
  ) {
    const empty = { signatures: [], connectionIds: [] };
    return (
      (await this.merged.route(
        mapId,
        async (w) => {
          for (const id of body.ids) await w.removeSignature(actor, mapId, id);
        },
        () => this.signatures.removeMany(actor, mapId, solarSystemId, body),
      )) ?? empty
    );
  }

  /** Not on merged maps: they hand out no undo. */
  @Post(nestPath(routes.signatures.restore.path))
  @HttpCode(200)
  restore(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(RestoreSignaturesRequest)) body: RestoreSignaturesRequest,
  ) {
    return this.signatures.restore(actor, mapId, body.signatures);
  }
}
