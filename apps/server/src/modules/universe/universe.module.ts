import {
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  Inject,
  Logger,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NotFoundError, requireAccount, ValidationError, type Actor } from '@darkbeacon/core';
import { fitMass, type UniverseCatalog } from '@darkbeacon/mapping';
import {
  EveId,
  FitMassRequest,
  nestPath,
  routes,
  ShipSearchQuery,
  UniverseLookupQuery,
  UniverseSearchQuery,
  type FitMassDto,
  type ShipCatalogDto,
  type ShipTypeDto,
  type UniverseSystemDto,
  type WormholeCatalogDto,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { StaticUniverseCatalog } from '../../adapters/universe/static-universe-catalog.js';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG, UNIVERSE_CATALOG } from '../../platform/tokens.js';

/**
 * Ships rolling crews use, offered before anyone searches: the battleships with the most mass
 * (Megathron, Typhoon), the Orca and Porpoise, and the heavy interdiction cruisers that take a mass
 * entangler (Onyx, Broadsword, Devoter, Phobos). SDE type ids.
 */
const SUGGESTED_SHIPS = [641, 644, 28606, 42244, 11995, 12013, 12017, 12021];

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

  @Get(nestPath(routes.universe.searchShips.path))
  searchShips(
    @CurrentActor() actor: Actor | null,
    @Query(new ZodPipe(ShipSearchQuery)) query: ShipSearchQuery,
  ): ShipTypeDto[] {
    requireAccount(actor);
    return this.catalog.searchShips(query.q, query.limit);
  }

  @Get(nestPath(routes.universe.shipCatalog.path))
  shipCatalog(@CurrentActor() actor: Actor | null): ShipCatalogDto {
    requireAccount(actor);
    return {
      modifiers: this.catalog.massModifiers(),
      suggested: SUGGESTED_SHIPS.flatMap((id) => this.catalog.ship(id) ?? []),
    };
  }

  @Post(nestPath(routes.universe.fitMass.path))
  @HttpCode(200)
  weighFit(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(FitMassRequest)) body: FitMassRequest,
  ): FitMassDto {
    requireAccount(actor);
    const weighed = fitMass(body.fit, this.catalog);
    if (!weighed) throw new ValidationError('Not a fit this server knows: paste it as the game copies it');
    return weighed;
  }

  @Get(nestPath(routes.universe.getShip.path))
  getShip(
    @CurrentActor() actor: Actor | null,
    @Param('shipTypeId', new ZodPipe(z.coerce.number().pipe(EveId))) shipTypeId: number,
  ): ShipTypeDto {
    requireAccount(actor);
    const ship = this.catalog.ship(shipTypeId);
    if (!ship) throw new NotFoundError('Ship');
    return ship;
  }

  @Get(nestPath(routes.universe.wormholes.path))
  wormholes(@CurrentActor() actor: Actor | null): WormholeCatalogDto {
    requireAccount(actor);
    return { types: this.catalog.wormholeTypes(), hullClasses: this.catalog.hullClasses() };
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
