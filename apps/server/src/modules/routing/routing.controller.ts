import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import { HubAdmin, RouteQueries, Waypoints } from '@darkbeacon/routing';
import {
  EveId,
  ExitsQuery,
  HubDistancesQuery,
  nestPath,
  RouteQuery,
  routes,
  SetHubsRequest,
  WaypointRequest,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';

@Controller()
export class RoutingController {
  constructor(
    @Inject(RouteQueries) private readonly queries: RouteQueries,
    @Inject(HubAdmin) private readonly hubs: HubAdmin,
    @Inject(Waypoints) private readonly waypoints: Waypoints,
  ) {}

  @Get(nestPath(routes.routing.route.path))
  route(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(RouteQuery)) query: RouteQuery,
  ) {
    return this.queries.route(actor, mapId, query);
  }

  @Get(nestPath(routes.routing.exits.path))
  exits(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(ExitsQuery)) query: ExitsQuery,
  ) {
    return this.queries.exits(actor, mapId, query);
  }

  @Get(nestPath(routes.routing.hubDistances.path))
  hubDistances(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(HubDistancesQuery)) query: HubDistancesQuery,
  ) {
    return this.queries.hubDistances(actor, mapId, query);
  }

  @Get(nestPath(routes.routing.hubs.path))
  mapHubs(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.queries.hubs(actor, mapId);
  }

  @Put(nestPath(routes.routing.setMapHubs.path))
  setMapHubs(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(SetHubsRequest)) body: SetHubsRequest,
  ) {
    return this.hubs.setMapHubs(actor, mapId, body.solarSystemIds);
  }

  @Get(nestPath(routes.routing.personalHubs.path))
  personalHubs(@CurrentActor() actor: Actor | null) {
    return this.hubs.personalHubs(actor);
  }

  @Put(nestPath(routes.routing.setPersonalHubs.path))
  setPersonalHubs(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(SetHubsRequest)) body: SetHubsRequest,
  ) {
    return this.hubs.setPersonalHubs(actor, body.solarSystemIds);
  }

  @Post(nestPath(routes.routing.waypoint.path))
  @HttpCode(204)
  async waypoint(
    @CurrentActor() actor: Actor | null,
    @Param('characterId', new ZodPipe(z.coerce.number().pipe(EveId))) characterId: number,
    @Body(new ZodPipe(WaypointRequest)) body: WaypointRequest,
  ): Promise<void> {
    await this.waypoints.set(actor, characterId, body);
  }
}
