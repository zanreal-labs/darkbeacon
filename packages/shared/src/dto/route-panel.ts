import { z } from 'zod';
import { EveId, Timestamp } from './common.js';
import { RouteAvoidSpace, RouteOptionsQuery, RouteSkip } from './route-options.js';
import { HubDto, RouteMode, RouteStepDto } from './routing.js';

/** Whose security status the `pilot` mode uses: one of the caller's characters, or a number. */
const PilotQuery = {
  characterId: z.coerce.number().pipe(EveId).optional(),
  securityStatus: z.coerce.number().min(-10).max(10).optional(),
};

const QueryFlag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

// --- Routes panel ------------------------------------------------------------------------------

/**
 * GET /api/maps/:mapId/routes/hubs: the route from one system to every hub of a list, with the
 * systems on the way, in one request. `hubs`: the map's hubs (and pinged systems) or the
 * viewer's own.
 */
export const HubRoutesQuery = z.object({
  from: z.coerce.number().pipe(EveId),
  hubs: z.enum(['map', 'personal']).default('map'),
  mode: RouteMode.default('shortest'),
  ...RouteOptionsQuery,
  ...PilotQuery,
});
export type HubRoutesQuery = z.infer<typeof HubRoutesQuery>;

export const HubRouteDto = HubDto.extend({
  /** Jumps from the asked system; null when no route satisfies the mode and options. */
  jumps: z.number().int().nullable(),
  /** The systems on the way, the asked system first; empty without a route. */
  steps: z.array(RouteStepDto),
});
export type HubRouteDto = z.infer<typeof HubRouteDto>;

export const HubRoutesDto = z.object({
  from: EveId,
  mode: RouteMode,
  /** Nearest first; hubs without a route last. */
  routes: z.array(HubRouteDto),
  /** The most hubs a list may hold. */
  limit: z.number().int(),
});
export type HubRoutesDto = z.infer<typeof HubRoutesDto>;

/** Route options the viewer keeps on the server (`/api/accounts/me/route-preferences`). */
export const RoutePreferencesDto = z.object({
  mode: RouteMode,
  skip: z.array(RouteSkip),
  avoidSpace: z.array(RouteAvoidSpace),
  /** Systems never to pass through. */
  avoid: z.array(EveId).max(200),
  /** Thera and Turnur holes from EVE-Scout (when the map allows them). */
  thera: z.boolean(),
  /** The map's Ansiblex jump bridges (those of the viewer's alliance). */
  bridges: z.boolean(),
  /** Flying a capital: no jump bridge at all. */
  capital: z.boolean(),
  /** The character whose security status the `pilot` mode uses. */
  characterId: EveId.nullable(),
});
export type RoutePreferencesDto = z.infer<typeof RoutePreferencesDto>;

export const UpdateRoutePreferencesRequest = RoutePreferencesDto.partial();
export type UpdateRoutePreferencesRequest = z.infer<typeof UpdateRoutePreferencesRequest>;

/** What a viewer starts with: the shortest way, every hole, bridge and Thera allowed. */
export const DEFAULT_ROUTE_PREFERENCES: RoutePreferencesDto = {
  mode: 'shortest',
  skip: [],
  avoidSpace: [],
  avoid: [],
  thera: true,
  bridges: true,
  capital: false,
  characterId: null,
};

/** The preferences as query parameters of the routing routes (defaults left out). */
export function routeOptionsParams(p: RoutePreferencesDto): Record<string, string> {
  const params: Record<string, string> = { mode: p.mode };
  if (p.skip.length > 0) params.skip = p.skip.join(',');
  if (p.avoidSpace.length > 0) params.avoidSpace = p.avoidSpace.join(',');
  if (p.avoid.length > 0) params.avoid = p.avoid.join(',');
  if (!p.thera) params.thera = 'false';
  if (!p.bridges) params.bridges = 'false';
  if (p.capital) params.capital = 'true';
  if (p.mode === 'pilot' && p.characterId !== null) params.characterId = String(p.characterId);
  return params;
}

/** A map's own routing settings (`GET/PATCH /api/maps/:mapId/routing-settings`). */
export const MapRoutingSettingsDto = z.object({
  /** Thera and Turnur holes from EVE-Scout count in this map's routes and its way home. */
  thera: z.boolean(),
});
export type MapRoutingSettingsDto = z.infer<typeof MapRoutingSettingsDto>;

export const UpdateMapRoutingSettingsRequest = MapRoutingSettingsDto.partial();
export type UpdateMapRoutingSettingsRequest = z.infer<typeof UpdateMapRoutingSettingsRequest>;

// --- Routes by: nearest places of a kind ---------------------------------------------------------

/**
 * `blueLoot`: NPC stations that buy Sleeper loot. `redLoot`: stations that buy Triglavian
 * loot. `securityOffice`: CONCORD security offices. `tradeHubs`: the five trade hubs. `thera`,
 * `turnur`: the known-space ends of EVE-Scout's Thera and Turnur holes.
 */
export const RoutesByKind = z.enum(['blueLoot', 'redLoot', 'securityOffice', 'tradeHubs', 'thera', 'turnur']);
export type RoutesByKind = z.infer<typeof RoutesByKind>;

/** GET /api/maps/:mapId/routes/by */
export const RoutesByQuery = z.object({
  from: z.coerce.number().pipe(EveId),
  kind: RoutesByKind,
  /** Only high-sec places. */
  highsec: QueryFlag.optional(),
  limit: z.coerce.number().int().min(1).max(15).default(15),
  mode: RouteMode.default('shortest'),
  ...RouteOptionsQuery,
  ...PilotQuery,
});
export type RoutesByQuery = z.infer<typeof RoutesByQuery>;

export const StationDto = z.object({
  id: EveId,
  name: z.string(),
  solarSystemId: EveId,
  /** The station people mean (Jita IV - Moon 4 - Caldari Navy Assembly Plant). */
  main: z.boolean(),
});
export type StationDto = z.infer<typeof StationDto>;

export const RoutesByEntryDto = z.object({
  solarSystemId: EveId,
  name: z.string(),
  security: z.number(),
  jumps: z.number().int(),
  steps: z.array(RouteStepDto),
  /** The stations there that offer what was asked for; empty for Thera and Turnur. */
  stations: z.array(StationDto),
});
export type RoutesByEntryDto = z.infer<typeof RoutesByEntryDto>;

export const RoutesByDto = z.object({
  from: EveId,
  kind: RoutesByKind,
  entries: z.array(RoutesByEntryDto),
});
export type RoutesByDto = z.infer<typeof RoutesByDto>;

/** GET /api/universe/systems/:solarSystemId/stations */
export const StationsDto = z.array(StationDto);
export type StationsDto = z.infer<typeof StationsDto>;

// --- Thera and Turnur (EVE-Scout) ----------------------------------------------------------------

/** One public hole of EVE-Scout's Thera or Turnur list. */
export const TheraConnectionDto = z.object({
  id: z.string(),
  /** The hub side: Thera or Turnur. */
  hub: z.enum(['thera', 'turnur']),
  hubSystemId: EveId,
  /** The other side. */
  solarSystemId: EveId,
  name: z.string(),
  security: z.number(),
  regionName: z.string(),
  whType: z.string().nullable(),
  /** Largest ship size that fits (EVE-Scout's words: small, medium, large, xlarge, capital). */
  maxShipSize: z.string().nullable(),
  /** Signature ids on the hub side and on the far side. */
  hubSignature: z.string().nullable(),
  signature: z.string().nullable(),
  remainingHours: z.number().nullable(),
  expiresAt: Timestamp.nullable(),
});
export type TheraConnectionDto = z.infer<typeof TheraConnectionDto>;

/** GET /api/routes/eve-scout */
export const TheraDto = z.object({
  connections: z.array(TheraConnectionDto),
  /** When EVE-Scout last answered; null before the first answer. */
  fetchedAt: Timestamp.nullable(),
});
export type TheraDto = z.infer<typeof TheraDto>;

// --- Way home ----------------------------------------------------------------------------------

/** How to get from a hub back into the chain: through which mouth, how far. */
export const WayHomeRouteDto = z.object({
  hub: HubDto,
  jumps: z.number().int(),
  /** The known-space system with the hole into the chain, where the trip leaves known space. */
  mouth: z.object({ solarSystemId: EveId, name: z.string(), security: z.number() }),
  /** The known-space part of the trip, hub to mouth: all high-sec, none of it, or both. */
  space: z.enum(['high', 'low', 'mixed']),
  /** The trip goes through Thera or Turnur. */
  viaEveScout: z.boolean(),
});
export type WayHomeRouteDto = z.infer<typeof WayHomeRouteDto>;

/** The way home from each hub: what `routes.way_home_changed` carries. */
export const WayHomeDto = z.object({
  home: z.object({ solarSystemId: EveId, name: z.string() }).nullable(),
  /** Nearest first; hubs without a way home are left out. */
  routes: z.array(WayHomeRouteDto),
});
export type WayHomeDto = z.infer<typeof WayHomeDto>;

// --- Waypoints for several characters ----------------------------------------------------------

/** POST /api/accounts/me/waypoints: one destination or waypoint for several own characters. */
export const WaypointsRequest = z.object({
  solarSystemId: EveId,
  stationId: EveId.optional(),
  mode: z.enum(['destination', 'waypoint', 'front']).default('destination'),
  /** The characters; absent means every own character whose grant allows it. */
  characterIds: z.array(EveId).max(100).optional(),
});
export type WaypointsRequest = z.infer<typeof WaypointsRequest>;

export const WaypointsResultDto = z.object({
  results: z.array(
    z.object({
      characterId: EveId,
      name: z.string(),
      ok: z.boolean(),
      message: z.string().nullable(),
    }),
  ),
});
export type WaypointsResultDto = z.infer<typeof WaypointsResultDto>;
