import { Controller, Get, Global, Inject, Logger, Module, Param, Query } from '@nestjs/common';
import { NotFoundError, requireAccount, type Actor } from '@darkbeacon/core';
import type { UniverseCatalog } from '@darkbeacon/mapping';
import {
  EveId,
  nestPath,
  routes,
  UniverseLookupQuery,
  UniverseSearchQuery,
  type UniverseSystemDto,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { StaticUniverseCatalog } from '../../adapters/universe/static-universe-catalog.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, UNIVERSE_CATALOG } from '../../platform/tokens.js';

@Controller()
export class UniverseController {
  constructor(@Inject(UNIVERSE_CATALOG) private readonly catalog: UniverseCatalog) {}

  @Get(nestPath(routes.universe.searchSystems.path))
  search(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(UniverseSearchQuery)) query: UniverseSearchQuery,
  ): UniverseSystemDto[] {
    requireAccount(actor);
    return this.catalog.searchSystems(query.q, query.limit);
  }

  @Get(nestPath(routes.universe.lookup.path))
  lookup(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(UniverseLookupQuery)) query: UniverseLookupQuery,
  ): UniverseSystemDto[] {
    requireAccount(actor);
    return query.ids.flatMap((id) => this.catalog.getSystem(id) ?? []);
  }

  @Get(nestPath(routes.universe.getSystem.path))
  get(
    @CurrentActor() actor: Actor | null,
    @Param('solarSystemId', new ZodPipe(z.coerce.number().pipe(EveId))) solarSystemId: number,
  ): UniverseSystemDto {
    requireAccount(actor);
    const system = this.catalog.getSystem(solarSystemId);
    if (!system) throw new NotFoundError('Solar system');
    return system;
  }
}

/** Static game data from the SDE: the UNIVERSE_CATALOG port for every module, and /api/universe. */
@Global()
@Module({
  controllers: [UniverseController],
  providers: [
    {
      provide: UNIVERSE_CATALOG,
      useFactory: (config: AppConfig) => {
        const catalog = StaticUniverseCatalog.load(config.dataDir);
        new Logger('Universe').log(`universe catalog: ${catalog.size} systems`);
        return catalog;
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [UNIVERSE_CATALOG],
})
export class UniverseModule {}
