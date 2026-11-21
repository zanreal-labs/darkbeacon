import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/*
 * Way-home watches: a pilot stuck in known space asks to be told when a way from there back to
 * the map's Home opens through the chain. Served under /api/maps/:mapId/route-watches (members);
 * the Discord notifier posts what `routes.watch_opened` and `routes.watch_closed` say.
 */

/** How the trip home may run: high-sec gates and wormholes only (`highsec`), or any way. */
export const RouteWatchMode = z.enum(['highsec', 'shortest']);
export type RouteWatchMode = z.infer<typeof RouteWatchMode>;

/** Jumps a watch may allow at most, the whole trip counted. */
export const ROUTE_WATCH_MAX_JUMPS = 60;
/** How long a watch may stay, in hours; 24 when not given. */
export const ROUTE_WATCH_MAX_HOURS = 72;
export const ROUTE_WATCH_DEFAULT_HOURS = 24;
/** Watches one account may keep on one map. */
export const ROUTE_WATCH_LIMIT = 5;

const WatchSystem = z.object({ solarSystemId: EveId, name: z.string(), security: z.number() });

/** A way home a watch found: the whole trip, the gate jumps to the mouth, the wormhole jumps after. */
export const RouteWatchRouteDto = z.object({
  jumps: z.number().int().nonnegative(),
  /** Jumps from the watched system to the mouth (stargates, bridges, Thera). */
  gates: z.number().int().nonnegative(),
  /** Jumps from the mouth through the chain to Home. */
  wormholeJumps: z.number().int().nonnegative(),
  /** The known-space system with the hole into the chain. */
  mouth: WatchSystem,
});
export type RouteWatchRouteDto = z.infer<typeof RouteWatchRouteDto>;

export const RouteWatchDto = z.object({
  id: Id,
  mapId: Id,
  /** Who set it: the only one it pings. */
  accountId: Id,
  ownerName: z.string(),
  target: WatchSystem,
  maxJumps: z.number().int().positive(),
  mode: RouteWatchMode,
  expiresAt: Timestamp,
  createdAt: Timestamp,
  /** The way home announced and still standing; null while the watch waits. */
  route: RouteWatchRouteDto.nullable(),
});
export type RouteWatchDto = z.infer<typeof RouteWatchDto>;

/** GET: the caller's watches on the map (every watch for map admins), and the Home they lead to. */
export const RouteWatchListDto = z.object({
  watches: z.array(RouteWatchDto),
  home: z.object({ solarSystemId: EveId, name: z.string() }).nullable(),
});
export type RouteWatchListDto = z.infer<typeof RouteWatchListDto>;

export const CreateRouteWatchRequest = z.object({
  /** The known-space system the pilot waits in. */
  solarSystemId: EveId,
  maxJumps: z.number().int().min(1).max(ROUTE_WATCH_MAX_JUMPS),
  mode: RouteWatchMode.default('highsec'),
  hours: z.number().int().min(1).max(ROUTE_WATCH_MAX_HOURS).default(ROUTE_WATCH_DEFAULT_HOURS),
});
export type CreateRouteWatchRequest = z.infer<typeof CreateRouteWatchRequest>;

/**
 * `routes.watch_opened`: a way home within the watch's limits opened (`opened`), moved to another
 * mouth (`moved`), or came back through the mouth announced last within 15 minutes of closing
 * (`again`, posted without a mention).
 */
export const RouteWatchOpenedEvent = z.object({
  watch: RouteWatchDto,
  route: RouteWatchRouteDto,
  home: z.object({ solarSystemId: EveId, name: z.string() }),
  change: z.enum(['opened', 'moved', 'again']),
});
export type RouteWatchOpenedEvent = z.infer<typeof RouteWatchOpenedEvent>;

/** `routes.watch_closed`: the way announced has been gone for five minutes. */
export const RouteWatchClosedEvent = z.object({
  watch: RouteWatchDto,
  mouth: WatchSystem,
  home: z.object({ solarSystemId: EveId, name: z.string() }).nullable(),
});
export type RouteWatchClosedEvent = z.infer<typeof RouteWatchClosedEvent>;

/** `routes.watch_removed`: the watch was removed by someone (`removed`) or ran out (`expired`). */
export const RouteWatchRemovedEvent = z.object({
  id: Id,
  accountId: Id,
  reason: z.enum(['removed', 'expired']),
});
export type RouteWatchRemovedEvent = z.infer<typeof RouteWatchRemovedEvent>;
