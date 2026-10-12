import type { ConnectionDto, MapSystemDto, UniverseSystemDto } from '@darkbeacon/shared';
import type { ExtraEdge } from '../domain/graph.js';

export type { Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';

/** Static game data the router needs (satisfied by the universe catalog). */
export interface RoutingUniverse {
  getSystem(solarSystemId: number): UniverseSystemDto | null;
  /** Every known system. */
  systems(): Iterable<UniverseSystemDto>;
  gateNeighbours(solarSystemId: number): readonly number[];
}

/** A map's chain as mapping stores it (composed from mapping in the server). */
export interface ChainSource {
  /** Null when the map does not exist. */
  chain(mapId: string): Promise<{
    systems: Array<Pick<MapSystemDto, 'solarSystemId' | 'visible'>>;
    connections: ConnectionDto[];
  } | null>;
}

/**
 * More two-way links for a map's routes, such as jump bridges from a plugin. Sources are asked on
 * every recompute; edges between systems the stargates already link are ignored.
 */
export interface RouteEdgeSource {
  edges(mapId: string): Promise<ExtraEdge[]>;
}

/** Hubs chosen by a map's managers and by each account, in their chosen order. */
export interface HubRepository {
  mapHubs(mapId: string): Promise<number[]>;
  setMapHubs(mapId: string, solarSystemIds: readonly number[]): Promise<void>;
  personalHubs(accountId: string): Promise<number[]>;
  setPersonalHubs(accountId: string, solarSystemIds: readonly number[]): Promise<void>;
  forgetMap(mapId: string): Promise<void>;
}

/** Characters as identity and ESI know them. */
export interface PilotDirectory {
  /** Account that owns a linked character, null when it is not linked. */
  ownerOf(characterId: number): Promise<string | null>;
  /** Public security status from ESI, null when ESI does not know the character. */
  securityStatus(characterId: number): Promise<number | null>;
  /** ESI scopes of the character's grant; empty without a working token. */
  scopes(characterId: number): Promise<string[]>;
  accessToken(characterId: number): Promise<string | null>;
}

/** ESI `POST /ui/autopilot/waypoint`. Throws when ESI refuses. */
export interface WaypointGateway {
  setWaypoint(
    accessToken: string,
    request: { destinationId: number; clearOtherWaypoints: boolean; addToBeginning: boolean },
  ): Promise<void>;
}
