import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Actor } from '@darkbeacon/core';
import {
  BridgeAdmin,
  HubAdmin,
  RouteQueries,
  RoutingSettings,
  TheraFeed,
  Waypoints,
  type StationCatalog,
} from '@darkbeacon/routing';
import {
  EveId,
  ExitsQuery,
  HubDistancesQuery,
  HubRoutesQuery,
  nestPath,
  PasteBridgesRequest,
  ReadBridgesFromEsiRequest,
  RouteQuery,
  routes,
  RoutesByQuery,
  SetHubsRequest,
  UpdateBridgeRequest,
  UpdateMapRoutingSettingsRequest,
  UpdateRoutePreferencesRequest,
  WaypointRequest,
  WaypointsRequest,
} from '@darkbeacon/shared';
import { z } from 'zod';
import { CurrentActor } from '../../platform/actor.js';
import { ZodPipe } from '../../platform/http.js';
import { ROUTING_STATIONS } from './routing.tokens.js';

@Controller()
export class RoutingController {
  constructor(
    @Inject(RouteQueries) private readonly queries: RouteQueries,
    @Inject(HubAdmin) private readonly hubs: HubAdmin,
    @Inject(Waypoints) private readonly waypoints: Waypoints,
    @Inject(BridgeAdmin) private readonly bridges: BridgeAdmin,
    @Inject(RoutingSettings) private readonly settings: RoutingSettings,
    @Inject(TheraFeed) private readonly thera: TheraFeed,
    @Inject(ROUTING_STATIONS) private readonly stations: StationCatalog,
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

  @Get(nestPath(routes.routing.hubRoutes.path))
  hubRoutes(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(HubRoutesQuery)) query: HubRoutesQuery,
  ) {
    return this.queries.hubRoutes(actor, mapId, query);
  }

  @Get(nestPath(routes.routing.routesBy.path))
  routesBy(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Query(new ZodPipe(RoutesByQuery)) query: RoutesByQuery,
  ) {
    return this.queries.routesBy(actor, mapId, query);
  }

  @Get(nestPath(routes.routing.wayHome.path))
  wayHome(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.queries.viewWayHome(actor, mapId);
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

  @Get(nestPath(routes.routing.preferences.path))
  preferences(@CurrentActor() actor: Actor | null) {
    return this.settings.preferences(actor);
  }

  @Put(nestPath(routes.routing.updatePreferences.path))
  updatePreferences(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(UpdateRoutePreferencesRequest)) body: UpdateRoutePreferencesRequest,
  ) {
    return this.settings.setPreferences(actor, body);
  }

  @Get(nestPath(routes.routing.mapSettings.path))
  mapSettings(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.settings.mapSettings(actor, mapId);
  }

  @Patch(nestPath(routes.routing.updateMapSettings.path))
  updateMapSettings(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(UpdateMapRoutingSettingsRequest)) body: UpdateMapRoutingSettingsRequest,
  ) {
    return this.settings.setMapSettings(actor, mapId, body);
  }

  @Get(nestPath(routes.routing.eveScout.path))
  eveScout() {
    return this.thera.snapshot();
  }

  @Get(nestPath(routes.routing.stations.path))
  stationsIn(@Param('solarSystemId', new ZodPipe(z.coerce.number().pipe(EveId))) solarSystemId: number) {
    return this.stations.stationsIn(solarSystemId);
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

  @Post(nestPath(routes.routing.waypoints.path))
  @HttpCode(200)
  waypointsForMany(
    @CurrentActor() actor: Actor | null,
    @Body(new ZodPipe(WaypointsRequest)) body: WaypointsRequest,
  ) {
    return this.waypoints.setMany(actor, body);
  }

  @Get(nestPath(routes.bridges.list.path))
  listBridges(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string) {
    return this.bridges.list(actor, mapId);
  }

  @Post(nestPath(routes.bridges.paste.path))
  @HttpCode(200)
  pasteBridges(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(PasteBridgesRequest)) body: PasteBridgesRequest,
  ) {
    return this.bridges.paste(actor, mapId, body);
  }

  @Post(nestPath(routes.bridges.readFromEsi.path))
  @HttpCode(200)
  readBridges(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Body(new ZodPipe(ReadBridgesFromEsiRequest)) body: ReadBridgesFromEsiRequest,
  ) {
    return this.bridges.readFromEsi(actor, mapId, body.characterId);
  }

  @Patch(nestPath(routes.bridges.update.path))
  updateBridge(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('bridgeId') bridgeId: string,
    @Body(new ZodPipe(UpdateBridgeRequest)) body: UpdateBridgeRequest,
  ) {
    return this.bridges.setDangerous(actor, mapId, bridgeId, body.dangerous);
  }

  @Delete(nestPath(routes.bridges.remove.path))
  @HttpCode(204)
  async removeBridge(
    @CurrentActor() actor: Actor | null,
    @Param('mapId') mapId: string,
    @Param('bridgeId') bridgeId: string,
  ): Promise<void> {
    await this.bridges.remove(actor, mapId, bridgeId);
  }

  @Delete(nestPath(routes.bridges.clear.path))
  @HttpCode(204)
  async clearBridges(@CurrentActor() actor: Actor | null, @Param('mapId') mapId: string): Promise<void> {
    await this.bridges.clear(actor, mapId);
  }
}
