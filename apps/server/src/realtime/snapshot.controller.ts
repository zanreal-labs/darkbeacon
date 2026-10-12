import { Controller, Get, Inject, Param } from '@nestjs/common';
import { NotFoundError, UnauthenticatedError, type Actor } from '@darkbeacon/core';
import { nestPath, routes, type StreamSnapshotDto } from '@darkbeacon/shared';
import { CurrentActor } from '../platform/actor.js';
import { RealtimeHub } from './realtime.hub.js';

/**
 * `GET /api/streams/:stream/snapshot`: what a WebSocket subscribe without `sinceSeq` would send,
 * so the server-rendered web app can paint a map before its socket opens and then resume from
 * `seq`. Streams the caller may not follow read as not found, so ids do not leak.
 */
@Controller()
export class SnapshotController {
  constructor(@Inject(RealtimeHub) private readonly hub: RealtimeHub) {}

  @Get(nestPath(routes.realtime.snapshot.path))
  async snapshot(
    @CurrentActor() actor: Actor | null,
    @Param('stream') stream: string,
  ): Promise<StreamSnapshotDto> {
    const denied = await this.hub.check(actor, stream);
    if (denied?.code === 'unauthenticated') throw new UnauthenticatedError();
    if (denied) throw new NotFoundError('Stream');
    const { seq, data } = await this.hub.readSnapshot(stream, actor);
    return { stream, seq, data };
  }
}
