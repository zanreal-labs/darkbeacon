import type {
  ConnectionDto,
  MapRoutingSettingsDto,
  MapSystemDto,
  RoutePreferencesDto,
  StationDto,
  UniverseSystemDto,
} from '@darkbeacon/shared';
import type { Invasion } from '../domain/modes.js';
import type { RoutedEdge } from '../domain/options.js';

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
    systems: Array<Pick<MapSystemDto, 'solarSystemId' | 'visible'> & Partial<Pick<MapSystemDto, 'status'>>>;
    connections: ConnectionDto[];
  } | null>;
}

/**
 * More two-way links for a map's routes: its Ansiblex jump bridges, EVE-Scout's Thera and Turnur
 * holes, or a plugin's. Sources are asked on every recompute; edges between systems the stargates
 * already link are ignored. Each edge says what route options look at (`state`, `origin`).
 */
export interface RouteEdgeSource {
  edges(mapId: string): Promise<RoutedEdge[]>;
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
  /** The account's linked characters. */
  charactersOf(accountId: string): Promise<Array<{ id: number; name: string }>>;
}

/** ESI `POST /ui/autopilot/waypoint`. Throws when ESI refuses. */
export interface WaypointGateway {
  setWaypoint(
    accessToken: string,
    request: { destinationId: number; clearOtherWaypoints: boolean; addToBeginning: boolean },
  ): Promise<void>;
}

/** How the Triglavian invasion left known-space systems (static data). */
export interface InvasionLookup {
  of(solarSystemId: number): Invasion | null;
}

/** An Ansiblex jump bridge as a map keeps it; `a` is the system with the lower id. */
export interface BridgeRecord {
  id: string;
  mapId: string;
  a: number;
  b: number;
  dangerous: boolean;
  source: 'paste' | 'esi';
  structureId: number | null;
  structureName: string | null;
  createdAt: number;
}

export type NewBridge = Omit<BridgeRecord, 'id' | 'createdAt'>;

export interface BridgeRepository {
  list(mapId: string): Promise<BridgeRecord[]>;
  find(mapId: string, id: string): Promise<BridgeRecord | null>;
  /** Adds bridges not on the map yet (by their pair) and updates the others; returns both. */
  upsert(
    bridges: readonly NewBridge[],
    options: { id(): string; now: number; keepDangerous: boolean },
  ): Promise<{ added: BridgeRecord[]; updated: BridgeRecord[]; known: number }>;
  setDangerous(mapId: string, id: string, dangerous: boolean): Promise<BridgeRecord | null>;
  remove(mapId: string, ids: readonly string[]): Promise<void>;
  forgetMap(mapId: string): Promise<void>;
}

/** An Ansiblex of a corporation, as ESI lists its structures. */
export interface CorporationAnsiblex {
  structureId: number;
  solarSystemId: number;
  name: string | null;
}

/**
 * ESI `GET /corporations/{corporation_id}/structures` (scope `esi-corporations.read_structures.v1`,
 * in-game role Station_Manager), Ansiblexes only. Throws `EsiStructuresError` (domain).
 */
export interface CorporationStructures {
  ansiblexes(characterId: number): Promise<CorporationAnsiblex[]>;
}

/** Distances between known-space systems (static data); null when one has no position. */
export interface SystemDistances {
  lightYears(a: number, b: number): number | null;
}

/** Who holds sovereignty over a system (ESI sovereignty map); null when nobody or not known. */
export interface SovereigntyLookup {
  holderOf(solarSystemId: number): number | null;
}

/** One public signature of EVE-Scout's Thera and Turnur lists. */
export interface EveScoutSignature {
  id: string;
  /** The hub side: Thera (31000005) or Turnur (30002086). */
  hubSystemId: number;
  hubSignature: string | null;
  solarSystemId: number;
  signature: string | null;
  whType: string | null;
  maxShipSize: string | null;
  remainingHours: number | null;
  expiresAt: number | null;
}

/** EVE-Scout's public API (`GET /v2/public/signatures`). Throws when it does not answer. */
export interface EveScoutClient {
  signatures(): Promise<EveScoutSignature[]>;
}

/** NPC stations (static data). */
export interface StationCatalog {
  stationsIn(solarSystemId: number): StationDto[];
  station(stationId: number): StationDto | null;
  /** Stations of a Routes By kind that has stations. */
  places(kind: 'securityOffice' | 'blueLoot' | 'redLoot' | 'tradeHubs'): StationDto[];
}

/**
 * Systems with an active ping on a map: temporary route targets. Pings are not built yet; the
 * server passes an adapter that finds none until they are.
 */
export interface PingTargets {
  pinged(mapId: string): Promise<number[]>;
}

/** The viewer's alliance (that of the main character), for which bridges they may use. */
export interface AllianceDirectory {
  allianceOf(accountId: string): Promise<number | null>;
}

/** Route preferences of accounts and routing settings of maps. */
export interface RoutingSettingsRepository {
  preferences(accountId: string): Promise<RoutePreferencesDto | null>;
  setPreferences(accountId: string, preferences: RoutePreferencesDto, now: number): Promise<void>;
  mapSettings(mapId: string): Promise<MapRoutingSettingsDto | null>;
  setMapSettings(mapId: string, settings: MapRoutingSettingsDto, now: number): Promise<void>;
  forgetMap(mapId: string): Promise<void>;
}
