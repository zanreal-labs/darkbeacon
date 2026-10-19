import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Actor, Clock } from '@darkbeacon/core';
import { CharacterService } from '@darkbeacon/identity';
import { JumpPilots, JumpPlanner } from '@darkbeacon/jumps';
import {
  EveId,
  JumpPlanRequest,
  JumpUniverseQuery,
  nestPath,
  routes,
  type JumpMetaDto,
  type JumpPilotDto,
  type JumpPlanDto,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EsiJumpPilot } from '../../adapters/jumps/esi-jump-pilot.js';
import { loadKspaceSource } from '../../adapters/jumps/kspace-source.js';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { APP_CONFIG, CLOCK, HTTP_FETCH } from '../../platform/tokens.js';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

@Controller()
export class JumpsController {
  /** The map's dataset, serialized and compressed once. */
  private body: { json: Buffer; gzip: Buffer } | null = null;

  constructor(
    @Inject(JumpPlanner) private readonly planner: JumpPlanner,
    @Inject(JumpPilots) private readonly pilots: JumpPilots,
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
    const data = this.planner.universe(actor);
    const etag = `"${this.planner.version}"`;
    reply
      .header('etag', etag)
      .header('vary', 'accept-encoding')
      .header(
        'cache-control',
        query.v === this.planner.version ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      );
    if (request.headers['if-none-match'] === etag) {
      reply.code(304).send();
      return;
    }
    if (!this.body) {
      const json = Buffer.from(JSON.stringify(data));
      this.body = { json, gzip: gzipSync(json, { level: 9 }) };
    }
    reply.header('content-type', 'application/json; charset=utf-8');
    if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
      reply.header('content-encoding', 'gzip').send(this.body.gzip);
    } else {
      reply.send(this.body.json);
    }
  }

  @Post(nestPath(routes.jumps.plan.path))
  @HttpCode(200)
  plan(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(JumpPlanRequest)) body: z.output<typeof JumpPlanRequest>,
  ): JumpPlanDto {
    return this.planner.plan(actor, body);
  }

  @Get(nestPath(routes.jumps.pilot.path))
  pilot(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
  ): Promise<JumpPilotDto> {
    return this.pilots.pilot(actor, characterId);
  }
}

/** The jump planner: ships, the k-space map, capital jump routes and my pilots' skills and fatigue. */
@Module({
  controllers: [JumpsController],
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
  ],
})
export class JumpsModule {}
