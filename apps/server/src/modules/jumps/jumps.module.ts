import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { NotFoundError, type Actor, type Clock } from '@darkbeacon/core';
import { Database } from '@darkbeacon/db';
import { CharacterService } from '@darkbeacon/identity';
import { FuelPrices, JumpPilots, JumpPlanner, JumpShares } from '@darkbeacon/jumps';
import {
  EveId,
  JumpFuelPricesQuery,
  JumpPlanRequest,
  JumpShareRequest,
  JumpUniverseQuery,
  nestPath,
  routes,
  type JumpFuelPricesDto,
  type JumpMetaDto,
  type JumpPilotDto,
  type JumpPlanDto,
  type JumpShareCreatedDto,
  type JumpShareViewDto,
  type JumpUniverseDto,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EsiFuelMarket } from '../../adapters/jumps/esi-fuel-market.js';
import { EsiJumpPilot } from '../../adapters/jumps/esi-jump-pilot.js';
import { KyselyJumpShareStore } from '../../adapters/jumps/kysely-jump-shares.js';
import { loadKspaceSource } from '../../adapters/jumps/kspace-source.js';
import type { AppConfig } from '../../config/config.js';
import { ClientIp, CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { LIMITS, RateLimiter } from '../../platform/rate-limiter.js';
import { APP_CONFIG, CLOCK, HTTP_FETCH } from '../../platform/tokens.js';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

@Controller()
export class JumpsController {
  constructor(
    @Inject(JumpPlanner) private readonly planner: JumpPlanner,
    @Inject(JumpPilots) private readonly pilots: JumpPilots,
    @Inject(FuelPrices) private readonly fuel: FuelPrices,
    @Inject(JumpShares) private readonly shares: JumpShares,
  ) {}

  @Get(nestPath(routes.jumps.meta.path))
  meta(@CurrentActor() actor: Actor | null): JumpMetaDto {
    return this.planner.meta(actor);
  }

  /**
   * Known space for the map, about 350 KB (125 KB gzipped). Asked for with `?v=<version>` it is
   * cached by the browser for good; otherwise it is revalidated by its ETag.
   */
  @Get(nestPath(routes.jumps.universe.path))
  universe(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(JumpUniverseQuery)) query: z.infer<typeof JumpUniverseQuery>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    sendUniverse(this.planner.universe(actor), this.planner.version, query.v, request, reply);
  }

  @Post(nestPath(routes.jumps.plan.path))
  @HttpCode(200)
  plan(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(JumpPlanRequest)) body: z.output<typeof JumpPlanRequest>,
  ): JumpPlanDto {
    return this.planner.plan(actor, body);
  }

  @Get(nestPath(routes.jumps.fuelPrices.path))
  fuelPrices(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(JumpFuelPricesQuery)) query: z.output<typeof JumpFuelPricesQuery>,
  ): Promise<JumpFuelPricesDto> {
    return this.fuel.prices(actor, query.hub);
  }

  @Post(nestPath(routes.jumps.share.path))
  @HttpCode(200)
  share(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(JumpShareRequest)) body: z.output<typeof JumpShareRequest>,
  ): Promise<JumpShareCreatedDto> {
    return this.shares.share(actor, body.plan, body.fuelHub);
  }

  @Get(nestPath(routes.jumps.pilot.path))
  pilot(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<JumpPilotDto> {
    return this.pilots.pilot(actor, characterId);
  }
}

/** The map's dataset, serialized and compressed once (it changes only with a new build). */
let universeBody: { version: string; json: Buffer; gzip: Buffer } | null = null;

/**
 * Known space for the map, about 350 KB (125 KB gzipped). Asked for with `?v=<version>` it is
 * cached by the browser for good; otherwise it is revalidated by its ETag.
 */
function sendUniverse(
  data: JumpUniverseDto,
  version: string,
  asked: string | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const etag = `"${version}"`;
  reply
    .header('etag', etag)
    .header('vary', 'accept-encoding')
    .header(
      'cache-control',
      asked === version ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    );
  if (request.headers['if-none-match'] === etag) {
    reply.code(304).send();
    return;
  }
  if (universeBody?.version !== version) {
    const json = Buffer.from(JSON.stringify(data));
    universeBody = { version, json, gzip: gzipSync(json, { level: 9 }) };
  }
  reply.header('content-type', 'application/json; charset=utf-8');
  if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
    reply.header('content-encoding', 'gzip').send(universeBody.gzip);
  } else {
    reply.send(universeBody.json);
  }
}

/**
 * Shared jump routes for anyone with the link (`/j/<token>`), without signing in: the route as
 * planned now from what was shared, and the map data. Both count against the per-address limit of
 * public reads, and the address (the secret) never leaves as a referrer.
 */
@Controller()
export class PublicJumpsController {
  constructor(
    @Inject(JumpShares) private readonly shares: JumpShares,
    @Inject(JumpPlanner) private readonly planner: JumpPlanner,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  private limit(ip: string | null, reply: FastifyReply): void {
    const limit = this.limiter.take(`public:${ip ?? 'unknown'}`, LIMITS.publicReads);
    if (!limit.ok) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new HttpException('Too many requests; slow down', 429);
    }
  }

  @Get(nestPath(routes.public.jumpUniverse.path))
  universe(
    @Query(new ZodPipe(JumpUniverseQuery)) query: z.infer<typeof JumpUniverseQuery>,
    @ClientIp() ip: string | null,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    this.limit(ip, reply);
    sendUniverse(this.planner.universeData(), this.planner.version, query.v, request, reply);
  }

  @Get(nestPath(routes.public.jumpShare.path))
  async share(
    @Param('token') token: string,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<JumpShareViewDto> {
    this.limit(ip, reply);
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-robots-tag', 'noindex, nofollow');
    const view = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? await this.shares.view(token) : null;
    if (!view) throw new NotFoundError('Shared route');
    return view;
  }
}

/** The jump planner: ships, the k-space map, capital jump routes and my pilots' skills and fatigue. */
@Module({
  controllers: [JumpsController, PublicJumpsController],
  providers: [
    {
      provide: JumpPlanner,
      useFactory: (config: AppConfig) => {
        const source = loadKspaceSource(config.dataDir);
        new Logger('Jumps').log(
          `k-space map ${source.version}: ${source.data.systems.id.length} systems, ${source.data.ships.length} ships`,
        );
        return new JumpPlanner(source);
      },
      inject: [APP_CONFIG],
    },
    {
      provide: JumpPilots,
      useFactory: (config: AppConfig, characters: CharacterService, clock: Clock, fetchFn: typeof fetch) =>
        new JumpPilots({
          characters,
          clock,
          esi: new EsiJumpPilot({
            clock,
            fetch: fetchFn,
            userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
            baseUrl: config.esiBaseUrl,
            accessToken: (id) => characters.accessToken(id),
          }),
        }),
      inject: [APP_CONFIG, CharacterService, CLOCK, HTTP_FETCH],
    },
    {
      provide: FuelPrices,
      useFactory: (config: AppConfig, clock: Clock, fetchFn: typeof fetch) =>
        new FuelPrices({
          clock,
          market: new EsiFuelMarket({
            clock,
            fetch: fetchFn,
            userAgent: `Darkbeacon/${version} (+${config.publicUrl})`,
            baseUrl: config.esiBaseUrl,
          }),
        }),
      inject: [APP_CONFIG, CLOCK, HTTP_FETCH],
    },
    {
      provide: JumpShares,
      useFactory: (db: Database, planner: JumpPlanner, fuel: FuelPrices, clock: Clock) =>
        new JumpShares({
          store: new KyselyJumpShareStore(db),
          planner,
          fuel,
          clock,
          token: () => randomBytes(16).toString('base64url'),
        }),
      inject: [Database, JumpPlanner, FuelPrices, CLOCK],
    },
  ],
})
export class JumpsModule {}
