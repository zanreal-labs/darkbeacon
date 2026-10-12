import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ConflictError, NotFoundError, type Actor } from '@darkbeacon/core';
import { ConnectionUseCases, MapBatchUseCases, MapSnapshotQuery } from '@darkbeacon/mapping';
import {
  BatchDeleteRequest,
  BatchUpsertRequest,
  nestPath,
  routes,
  SystemPairParams,
  UpdateConnectionRequest,
  type BatchDeleteResultDto,
  type BatchUpsertResultDto,
  type ConnectionDto,
} from '@darkbeacon/shared';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { MergedWriteRouter } from './merged-writes.js';

const pair = new ZodPipe(SystemPairParams);

/** Integration helpers on a map: batches and connections named by their systems. */
@Controller()
export class MapApiController {
  constructor(
    @Inject(MapBatchUseCases) private readonly batch: MapBatchUseCases,
    @Inject(ConnectionUseCases) private readonly connections: ConnectionUseCases,
    @Inject(MapSnapshotQuery) private readonly snapshots: MapSnapshotQuery,
    @Inject(MergedWriteRouter) private readonly merged: MergedWriteRouter,
  ) {}

  @Post(nestPath(routes.mapApi.batchUpsert.path))
  @HttpCode(200)
  upsert(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(BatchUpsertRequest)) body: BatchUpsertRequest,
  ): Promise<BatchUpsertResultDto> {
    return this.merged.route(mapId, refuseMerged, () =>
      this.batch.upsert(actor, mapId, body),
    ) as Promise<BatchUpsertResultDto>;
  }

  @Post(nestPath(routes.mapApi.batchDelete.path))
  @HttpCode(200)
  remove(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(BatchDeleteRequest)) body: BatchDeleteRequest,
  ): Promise<BatchDeleteResultDto> {
    return this.merged.route(mapId, refuseMerged, () =>
      this.batch.remove(actor, mapId, body),
    ) as Promise<BatchDeleteResultDto>;
  }

  @Get(nestPath(routes.mapApi.connectionByPair.path))
  byPair(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param() params: Record<string, string>,
  ): Promise<ConnectionDto> {
    return this.find(actor, mapId, params);
  }

  @Patch(nestPath(routes.mapApi.updateConnectionByPair.path))
  async updateByPair(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param() params: Record<string, string>,
    @Body(new ZodPipe(UpdateConnectionRequest)) body: UpdateConnectionRequest,
  ) {
    const { id } = await this.find(actor, mapId, params);
    return this.merged.route(
      mapId,
      (w) => w.updateConnection(actor, mapId, id, body),
      () => this.connections.update(actor, mapId, id, body),
    );
  }

  @Delete(nestPath(routes.mapApi.removeConnectionByPair.path))
  @HttpCode(204)
  async removeByPair(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param() params: Record<string, string>,
  ): Promise<void> {
    const { id } = await this.find(actor, mapId, params);
    await this.merged.route(
      mapId,
      (w) => w.removeConnection(actor, mapId, id),
      () => this.connections.remove(actor, mapId, id),
    );
  }

  /** The connection between the two systems as the map shows it (merged maps: the merged one). */
  private async find(
    actor: Actor | null,
    mapId: string,
    params: Record<string, string>,
  ): Promise<ConnectionDto> {
    const { source, target } = pair.transform(params) as { source: number; target: number };
    const { connections } = await this.snapshots.snapshot(actor, mapId);
    const found = connections.find(
      (c) => (c.source === source && c.target === target) || (c.source === target && c.target === source),
    );
    if (!found) throw new NotFoundError('Connection');
    return found;
  }
}

function refuseMerged(): never {
  throw new ConflictError('This map merges other maps: change its systems and connections one at a time');
}
