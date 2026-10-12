import { gzipSync } from 'node:zlib';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Module,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { JumpPlanner } from '@darkbeacon/jumps';
import {
  JumpPlanRequest,
  JumpUniverseQuery,
  nestPath,
  routes,
  type JumpMetaDto,
  type JumpPlanDto,
} from '@darkbeacon/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { loadKspaceSource } from '../../adapters/jumps/kspace-source.js';
import type { AppConfig } from '../../config/config.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { APP_CONFIG } from '../../platform/tokens.js';

@Controller()
export class JumpsController {
  /** The map's dataset, serialized and compressed once. */
  private body: { json: Buffer; gzip: Buffer } | null = null;

  constructor(@Inject(JumpPlanner) private readonly planner: JumpPlanner) {}

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
}

/** The jump planner: ships, the k-space map and capital jump routes. */
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
  ],
})
export class JumpsModule {}
