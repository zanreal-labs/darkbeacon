import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';
import { Bubbled, ConnectionType, MassStatus, ShipSize, TimeStatus } from './mapping.js';
import { HullClass, WormholeDestination } from './wormholes.js';
import { RouteOptionsQuery } from './route-options.js';

// --- Connections panel ---------------------------------------------------------------------

/** One end of a connection: the system and the signature of the hole on that side. */
export const ConnectionSideDto = z.object({
  solarSystemId: EveId,
  name: z.string(),
  /** SDE wormhole class id (see UniverseSystemDto). */
  whClass: z.number().int().nullable(),
  /** "C3", "HS", "Thera"... */
  classLabel: z.string().nullable(),
  security: z.number(),
  /** The signature linked to the connection in this system, if any. */
  signature: z.object({ id: Id, eveId: z.string(), type: z.string().nullable() }).nullable(),
});
export type ConnectionSideDto = z.infer<typeof ConnectionSideDto>;

export const Urgency = z.enum(['critical', 'warning', 'ok']);
export type Urgency = z.infer<typeof Urgency>;

/**
 * Everything the connections panel shows about one connection, derived on the server from the
 * connection, its signatures, the wormhole type's SDE attributes and recorded passages.
 * Estimates are upper bounds: a hole may have spawned before anyone saw it.
 */
export const ConnectionIntelDto = z.object({
  connectionId: Id,
  type: ConnectionType,
  source: ConnectionSideDto,
  target: ConnectionSideDto,
  /** The wormhole type (never K162 when the other side is known); null when unknown. */
  wormholeType: z.string().nullable(),
  /** `signature`: typed on a signature; `static`: guessed from the one static that leads there. */
  wormholeTypeFrom: z.enum(['signature', 'static']).nullable(),
  /** The side whose hole has that type (the other side sees a K162). */
  wormholeTypeSide: z.enum(['source', 'target']).nullable(),
  timeStatus: TimeStatus,
  massStatus: MassStatus,
  shipSize: ShipSize,
  massSaved: z.boolean(),
  dangerous: z.boolean(),
  bubbled: Bubbled,
  /** Heaviest single ship (kg) that may jump; null when the type is unknown. */
  maxJumpMass: z.number().nullable(),
  /** Hull classes that fit through in one jump. */
  fits: z.array(HullClass),
  mass: z.object({
    /** Nominal total mass of the type (the game varies it by ±10 %). */
    total: z.number().nullable(),
    /** Mass of recorded passages since the mass status was last set (kg). */
    passed: z.number(),
    /** Recorded passages since then, and how many of them had an unknown ship. */
    passages: z.number().int(),
    unknownPassages: z.number().int(),
    /** Estimate: what the mass status allows when it was set, minus what passed since. */
    remaining: z.number().nullable(),
    remainingFraction: z.number().nullable(),
    /** Frigate holes regain their mass, so they never run out. */
    regenerates: z.boolean(),
    /** The status the estimate implies (> 50 % fresh, 10-50 % reduced, < 10 % critical). */
    estimatedStatus: MassStatus.nullable(),
  }),
  time: z.object({
    /** When the map first saw the hole: the connection or one of its signatures, whichever is older. */
    firstSeenAt: Timestamp,
    lifetimeHours: z.number().nullable(),
    eolAt: Timestamp.nullable(),
    /** Latest moment the hole can still exist; null when neither the type nor EOL is known. */
    expiresBy: Timestamp.nullable(),
    remainingMs: z.number().nullable(),
  }),
  /** Every recorded passage (not only since the mass status was set). */
  totalPassages: z.number().int(),
  ageMs: z.number(),
  /** critical: < 10 % mass or < 1 h left; warning: EOL, reduced or < 4 h left. */
  urgency: Urgency,
});
export type ConnectionIntelDto = z.infer<typeof ConnectionIntelDto>;

/** A ship that went through a connection, recorded from tracked characters' jumps. */
export const PassageDto = z.object({
  id: Id,
  connectionId: Id,
  characterId: EveId,
  shipTypeId: EveId.nullable(),
  /** Hull mass of the ship (kg), null when the ship type is unknown. */
  mass: z.number().nullable(),
  from: EveId,
  to: EveId,
  occurredAt: Timestamp,
});
export type PassageDto = z.infer<typeof PassageDto>;

// --- Routes --------------------------------------------------------------------------------

/**
 * Route preferences. `shortest`: fewest jumps. `safer`: avoids low, null and wormhole space where
 * a detour allows. `highsec`: known space only in high-sec (true security >= 0.45, shown 0.5+);
 * the chain's wormhole systems may still be crossed. `outlaw`: never enters high-sec. `pilot`:
 * fewest jumps without entering high-sec systems where faction police attack the pilot.
 */
export const RouteMode = z.enum(['shortest', 'safer', 'highsec', 'outlaw', 'pilot']);
export type RouteMode = z.infer<typeof RouteMode>;

/** Whose security status the `pilot` mode uses: one of the caller's characters, or a number. */
const PilotQuery = {
  characterId: z.coerce.number().pipe(EveId).optional(),
  securityStatus: z.coerce.number().min(-10).max(10).optional(),
};

/** GET /api/maps/:mapId/route */
export const RouteQuery = z.object({
  from: z.coerce.number().pipe(EveId),
  to: z.coerce.number().pipe(EveId),
  mode: RouteMode.default('shortest'),
  ...RouteOptionsQuery,
  ...PilotQuery,
});
export type RouteQuery = z.infer<typeof RouteQuery>;

export const RouteStepDto = z.object({
  solarSystemId: EveId,
  name: z.string(),
  security: z.number(),
  whClass: z.number().int().nullable(),
  classLabel: z.string().nullable(),
  /** How the route got here; `start` for the first system. */
  via: z.enum(['start', 'gate', 'wormhole', 'bridge']),
  /** The chain connection used for `wormhole` and `bridge` steps. */
  connectionId: Id.nullable(),
  /**
   * Where a step off the stargates comes from when it is not a map connection: an Ansiblex jump
   * bridge of the map, or a Thera or Turnur hole EVE-Scout lists.
   */
  edge: z.enum(['ansiblex', 'eve-scout']).optional(),
  regionName: z.string().optional(),
  /** Triglavian invasion outcome of a known-space system (see `InvasionStatus`). */
  invasion: z.enum(['edencom', 'triglavian', 'final']).optional(),
});
export type RouteStepDto = z.infer<typeof RouteStepDto>;

export const RouteDto = z.object({
  from: EveId,
  to: EveId,
  mode: RouteMode,
  /** Number of jumps; null when no route satisfies the mode and options. */
  jumps: z.number().int().nullable(),
  steps: z.array(RouteStepDto),
  /** The security status the `pilot` mode used. */
  securityStatus: z.number().nullable(),
});
export type RouteDto = z.infer<typeof RouteDto>;

/**
 * `trade`: the five trade hubs. `staging`: in outlaw and pilot modes, the nearest system the mode
 * allows next to a trade hub it does not (a low-sec staging system for outlaws). `map`: chosen by
 * the map's managers. `personal`: chosen by the viewer.
 */
export const HubKind = z.enum(['trade', 'staging', 'map', 'personal', 'ping']);
export type HubKind = z.infer<typeof HubKind>;

export const HubDto = z.object({
  solarSystemId: EveId,
  name: z.string(),
  security: z.number(),
  kind: HubKind,
  /** For `staging`: the trade hub it stands in for. */
  near: z.object({ solarSystemId: EveId, name: z.string() }).nullable(),
});
export type HubDto = z.infer<typeof HubDto>;

/** The kind of space a whole route runs through; `mixed` when it crosses more than one kind. */
export const RouteSpace = z.enum(['high', 'low', 'null', 'mixed']);
export type RouteSpace = z.infer<typeof RouteSpace>;

export const HubDistanceDto = HubDto.extend({
  /** Jumps from the asked system; null when the mode allows no route. */
  jumps: z.number().int().nullable(),
  /**
   * For an exit's `nearest` hub: the space the route runs through, start and hub included
   * (`high` only when every system on it is high-sec). Absent elsewhere.
   */
  space: RouteSpace.optional(),
});
export type HubDistanceDto = z.infer<typeof HubDistanceDto>;

/** GET /api/maps/:mapId/hubs: the hubs this viewer gets distances to. */
export const HubsDto = z.object({
  trade: z.array(HubDto),
  map: z.array(HubDto),
  personal: z.array(HubDto),
});
export type HubsDto = z.infer<typeof HubsDto>;

/** PUT /api/maps/:mapId/hubs (manager+) and PUT /api/accounts/me/hubs replace the whole list. */
export const SetHubsRequest = z.object({ solarSystemIds: z.array(EveId).max(20) });
export type SetHubsRequest = z.infer<typeof SetHubsRequest>;

/** GET /api/maps/:mapId/hubs/distances */
export const HubDistancesQuery = z.object({
  from: z.coerce.number().pipe(EveId),
  mode: RouteMode.default('shortest'),
  ...RouteOptionsQuery,
  ...PilotQuery,
});
export type HubDistancesQuery = z.infer<typeof HubDistancesQuery>;

/**
 * A way out of the chain. `connected`: a known-space system the chain reaches through a wormhole
 * (with distances to the hubs). `static`: a wormhole system with a static to known space that no
 * connection on the map uses yet (where it lands is not known).
 */
export const MapExitDto = z.object({
  kind: z.enum(['connected', 'static']),
  solarSystemId: EveId,
  name: z.string(),
  security: z.number(),
  whClass: z.number().int().nullable(),
  classLabel: z.string().nullable(),
  /** `connected`: the wormhole connection into the chain. */
  connectionId: Id.nullable(),
  /** `connected`: the chain system on the other side of that wormhole. */
  chainSystemId: EveId.nullable(),
  /** `static`: the static types that lead to known space and where to. */
  statics: z.array(z.object({ code: z.string(), destination: WormholeDestination })),
  /** Nearest hub by jumps (trade, staging, map and the viewer's own hubs). */
  nearest: HubDistanceDto.nullable(),
  /** Jumps to every hub, nearest first. */
  hubs: z.array(HubDistanceDto),
});
export type MapExitDto = z.infer<typeof MapExitDto>;

/** GET /api/maps/:mapId/exits */
export const ExitsQuery = z.object({
  mode: RouteMode.default('shortest'),
  ...RouteOptionsQuery,
  ...PilotQuery,
});
export type ExitsQuery = z.infer<typeof ExitsQuery>;

export const MapExitsDto = z.object({ mode: RouteMode, exits: z.array(MapExitDto) });
export type MapExitsDto = z.infer<typeof MapExitsDto>;

/**
 * POST /api/accounts/me/characters/:characterId/waypoint: sets the in-game destination (clearing
 * other waypoints) or adds a waypoint, through ESI. Needs `esi-ui.write_waypoint.v1`.
 */
export const WaypointRequest = z.object({
  solarSystemId: EveId,
  /**
   * `destination` replaces the route; `waypoint` appends to it; `front` puts it first and keeps
   * the rest of the route.
   */
  mode: z.enum(['destination', 'waypoint', 'front']).default('destination'),
  /** An NPC station in that system to fly to instead of the system itself. */
  stationId: EveId.optional(),
});
export type WaypointRequest = z.infer<typeof WaypointRequest>;
