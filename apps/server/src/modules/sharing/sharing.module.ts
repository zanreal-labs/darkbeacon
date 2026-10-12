import {
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Res,
  type OnModuleInit,
} from '@nestjs/common';
import { InstanceSettingsService } from '@darkbeacon/access';
import {
  mapStream,
  NotFoundError,
  type Actor,
  type Clock,
  type EventLog,
  type MapAccess,
  type UnitOfWork,
} from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import type { UniverseCatalog } from '@darkbeacon/mapping';
import { MapSharing } from '@darkbeacon/sharing';
import {
  isEventOfType,
  nestPath,
  routes,
  UpdateMapSharingRequest,
  type MapSharingDto,
  type PublicMapViewDto,
} from '@darkbeacon/shared';
import type { FastifyReply } from 'fastify';
import { cryptoShareSecrets, KyselyMapShareRepository } from '../../adapters/sharing/kysely-map-shares.js';
import type { AppConfig } from '../../config/config.js';
import { ClientIp, CurrentActor } from '../../platform/actor.js';
import { EventConsumers } from '../../platform/event-consumers.js';
import { ZodPipe } from '../../platform/http.js';
import { LIMITS, RateLimiter } from '../../platform/rate-limiter.js';
import {
  APP_CONFIG,
  CLOCK,
  EVENT_LOG,
  MAP_ACCESS,
  UNIT_OF_WORK,
  UNIVERSE_CATALOG,
} from '../../platform/tokens.js';
import { RealtimeHub } from '../../realtime/realtime.hub.js';
import { RealtimeRegistry } from '../../realtime/realtime.registry.js';

const r = routes.sharing;

@Controller()
export class SharingController {
  constructor(@Inject(MapSharing) private readonly sharing: MapSharing) {}

  @Get(nestPath(r.get.path))
  get(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<MapSharingDto> {
    return this.sharing.get(actor, mapId);
  }

  @Patch(nestPath(r.update.path))
  update(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(UpdateMapSharingRequest)) body: UpdateMapSharingRequest,
  ): Promise<MapSharingDto> {
    return this.sharing.update(actor, mapId, body);
  }

  @Post(nestPath(r.regenerate.path))
  @HttpCode(200)
  regenerate(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<MapSharingDto> {
    return this.sharing.regenerate(actor, mapId);
  }
}

/** `GET /api/public/maps/:token`: no session, rate limited per address, never cached. */
@Controller()
export class PublicMapsController {
  constructor(
    @Inject(MapSharing) private readonly sharing: MapSharing,
    @Inject(UNIVERSE_CATALOG) private readonly universe: UniverseCatalog,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Get(nestPath(routes.public.map.path))
  async map(
    @Param('token') token: string,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicMapViewDto> {
    const limit = this.limiter.take(`public:${ip ?? 'unknown'}`, LIMITS.publicReads);
    if (!limit.ok) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new HttpException('Too many requests; slow down', 429);
    }
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    const access = await this.sharing.resolve(token);
    if (!access) throw new NotFoundError('Public map');
    if (access.share.noindex) reply.header('x-robots-tag', 'noindex, nofollow');
    const view = await this.sharing.view(access);
    const ids = view.snapshot.systems.map((s) => s.solarSystemId);
    return {
      map: view.map,
      stream: `public:${token}`,
      seq: view.seq,
      snapshot: view.snapshot,
      universe: ids.flatMap((id) => this.universe.getSystem(id) ?? []),
    };
  }
}

/**
 * Public maps: a map admin switches on a link (`/p/<token>`) that anyone can open read-only,
 * choosing what it shows. Visitors read the map as a `public` actor through the same use cases,
 * cut down by the projection; they follow it live on `public:<token>` streams (anonymous,
 * read-only, no presence). Without this module there are no public links.
 */
@Global()
@Module({
  controllers: [SharingController, PublicMapsController],
  providers: [
    {
      provide: MapSharing,
      useFactory: (
        db: Database,
        access: MapAccess,
        settings: InstanceSettingsService,
        hub: RealtimeHub,
        uow: UnitOfWork,
        events: EventLog,
        clock: Clock,
        config: AppConfig,
      ) =>
        new MapSharing({
          shares: new KyselyMapShareRepository(db),
          access,
          policy: {
            publicMaps: async () => (await settings.current()).publicMaps ?? true,
            mcpMode: async () => (await settings.current()).mcpMode ?? 'off',
          },
          secrets: cryptoShareSecrets,
          snapshots: { read: (actor, mapId) => hub.readSnapshot(mapStream(mapId), actor) },
          uow,
          events,
          clock,
          publicUrl: config.publicUrl,
        }),
      inject: [
        Database,
        MAP_ACCESS,
        InstanceSettingsService,
        RealtimeHub,
        UNIT_OF_WORK,
        EVENT_LOG,
        CLOCK,
        APP_CONFIG,
      ],
    },
  ],
  exports: [MapSharing],
})
export class SharingModule implements OnModuleInit {
  constructor(
    @Inject(MapSharing) private readonly sharing: MapSharing,
    @Inject(RealtimeRegistry) private readonly realtime: RealtimeRegistry,
    @Inject(EventConsumers) private readonly consumers: EventConsumers,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  onModuleInit(): void {
    this.realtime.registerStream('public', {
      authorize: async (_actor, id) => (await this.sharing.resolve(id)) !== null,
      admit: (_id, client) =>
        this.limiter.take(`public-ws:${client.ip ?? 'unknown'}`, LIMITS.publicSubscribes).ok,
      view: {
        source: async (id) => {
          const access = await this.sharing.resolve(id);
          return access ? mapStream(access.share.mapId) : null;
        },
        project: async (id, event, stream) => {
          const access = await this.sharing.resolve(id);
          return access ? this.sharing.project(access, event, stream) : null;
        },
      },
    });
    this.realtime.registerSnapshot('public', async (id) => {
      const access = await this.sharing.resolve(id);
      if (!access) return {};
      const view = await this.sharing.view(access);
      return { map: view.map, ...view.snapshot };
    });
    this.consumers.register({
      name: 'sharing.removed-maps',
      streams: ['map'],
      types: ['map.removed'],
      handle: async (event) => {
        if (isEventOfType(event, 'map.removed')) await this.sharing.forgetMap(event.data.id);
      },
    });
  }
}
