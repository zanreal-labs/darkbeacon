import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import {
  mapStream,
  matchesFilter,
  NotFoundError,
  UnauthenticatedError,
  type Actor,
  type DomainEvent,
  type EventLog,
} from '@darkbeacon/core';
import {
  EventsQuery,
  nestPath,
  routes,
  SseQuery,
  type EventsPageDto,
  type ServerMessage,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/config.js';
import { ActorResolverRegistry, bearerToken, ClientIp, CurrentActor, sameOrigin } from '../platform/actor.js';
import { ZodPipe } from '../platform/http.js';
import { APP_CONFIG, EVENT_LOG } from '../platform/tokens.js';
import { RealtimeHub } from './realtime.hub.js';
import { SseStreams, sseFrame } from './sse.js';

/**
 * Events for integrations that do not hold a WebSocket: a page of a map's events after a seq
 * (`GET /api/maps/:mapId/events`), and Server-Sent Events of any stream the caller may follow
 * (`GET /api/streams/:stream/sse`). Both authorize like a WebSocket subscribe.
 */
@Controller()
export class EventsController {
  private readonly publicOrigin: string;

  constructor(
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(EVENT_LOG) private readonly log: EventLog,
    @Inject(SseStreams) private readonly sse: SseStreams,
    @Inject(ActorResolverRegistry) private readonly actors: ActorResolverRegistry,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.publicOrigin = new URL(config.publicUrl).origin;
  }

  @Get(nestPath(routes.mapApi.events.path))
  async events(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(EventsQuery)) query: EventsQuery,
  ): Promise<EventsPageDto> {
    const stream = mapStream(mapId);
    await this.authorize(actor, stream);
    const [head, oldest] = await Promise.all([this.log.headSeq(stream), this.log.oldestSeq(stream)]);
    const read = await this.log.readSince(stream, query.sinceSeq, query.limit);
    const types = query.types;
    const events: DomainEvent[] = types?.length ? read.filter((e) => matchesFilter(e, { types })) : read;
    const nextSeq = read.at(-1)?.seq ?? Math.min(query.sinceSeq, head);
    return {
      events,
      nextSeq,
      headSeq: head,
      more: nextSeq < head && read.length === query.limit,
      gap: query.sinceSeq < head && oldest !== null && oldest > query.sinceSeq + 1,
    };
  }

  @Get(nestPath(routes.mapApi.sse.path))
  async stream(
    @CurrentActor() actor: Actor | null,
    @ClientIp() ip: string | null,
    @Param('stream') stream: string,
    @Query(new ZodPipe(SseQuery)) query: SseQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.authorize(actor, stream);
    const lastEventId = Number(request.headers['last-event-id']);
    let sinceSeq =
      query.sinceSeq ?? (Number.isSafeInteger(lastEventId) && lastEventId >= 0 ? lastEventId : undefined);
    // Without a place to resume from, start at the newest event unless a snapshot was asked for.
    if (sinceSeq === undefined && !query.snapshot) sinceSeq = await this.log.headSeq(stream);
    const types = query.types?.length ? query.types : null;
    this.sse.start({
      request,
      reply,
      stream,
      actor,
      ip,
      sinceSeq,
      resolveActor: () => this.resolve(request, ip),
      frame: (message) => nativeFrame(message, types),
    });
  }

  /** The actor again, as the guard read it: a bearer token, or a same-origin session. */
  private resolve(request: FastifyRequest, ip: string | null): Promise<Actor | null> {
    const like = { headers: request.headers, ip, url: request.url };
    if (bearerToken(like)) return this.actors.resolve(like);
    return sameOrigin(request.headers, this.publicOrigin) ? this.actors.session(like) : Promise.resolve(null);
  }

  private async authorize(actor: Actor | null, stream: string): Promise<void> {
    const denied = await this.hub.check(actor, stream);
    if (denied?.code === 'unauthenticated') throw new UnauthenticatedError();
    if (denied) throw new NotFoundError('Stream');
  }
}

/** Hub messages as native SSE frames: events by type with the seq as id. */
function nativeFrame(message: ServerMessage, types: string[] | null): string | null {
  switch (message.op) {
    case 'event':
      if (types && !matchesFilter(message.event, { types })) return null;
      return sseFrame(message.event.type, message.event, message.event.seq);
    case 'snapshot':
      return sseFrame(
        'snapshot',
        { stream: message.stream, seq: message.seq, data: message.data },
        message.seq,
      );
    case 'subscribed':
      return sseFrame('subscribed', { stream: message.stream, seq: message.seq, mode: message.mode });
    case 'error':
      return sseFrame('error', {
        stream: message.stream ?? null,
        code: message.code,
        message: message.message,
      });
    default:
      return null;
  }
}
