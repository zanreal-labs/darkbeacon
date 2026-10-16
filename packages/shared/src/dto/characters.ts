import { z } from 'zod';
import { EveId, Id, Timestamp } from './common.js';

/**
 * Scopes a character grants only when its owner opts in: assets (ship fit mass), wallet, and
 * structures (the structures it may use, to find jump bridges).
 */
export const OptionalEveScope = z.enum(['assets', 'wallet', 'structures']);
export type OptionalEveScope = z.infer<typeof OptionalEveScope>;

/** What each ESI scope Darkbeacon asks for is used for, in words people recognise. */
export const EVE_SCOPE_LABELS: Readonly<Record<string, string>> = {
  'esi-location.read_location.v1': 'Location',
  'esi-location.read_ship_type.v1': 'Ship',
  'esi-location.read_online.v1': 'Online status',
  'esi-ui.write_waypoint.v1': 'Set destination and waypoints',
  'esi-search.search_structures.v1': 'Search in name pickers',
  'esi-characters.read_contacts.v1': 'Character contacts (standings)',
  'esi-corporations.read_contacts.v1': 'Corporation contacts (standings)',
  'esi-alliances.read_contacts.v1': 'Alliance contacts (standings)',
  'esi-corporations.read_structures.v1': 'Corporation structures (jump bridges)',
  'esi-assets.read_assets.v1': 'Assets (the ship you fly, for jump mass)',
  'esi-wallet.read_character_wallet.v1': 'Wallet balance',
  'esi-universe.read_structures.v1': 'Structures you may use (finding jump bridges)',
};

/** A readable name for an ESI scope (the scope itself when it is not one Darkbeacon knows). */
export function eveScopeLabel(scope: string): string {
  return EVE_SCOPE_LABELS[scope] ?? scope;
}

/**
 * Why tracking cannot read where a character is: `refused` (ESI said 401/403: a scope is missing
 * or the grant is gone; linking the character again fixes both) or `unavailable` (ESI errors,
 * rate limits, timeouts). An expired sign-in is not one: the character says so itself.
 */
export const TrackingProblemKind = z.enum(['refused', 'unavailable']);
export type TrackingProblemKind = z.infer<typeof TrackingProblemKind>;

export const TrackingProblemDto = z.object({
  kind: TrackingProblemKind,
  /** One sentence for the character's owner, with ESI's answer. */
  message: z.string(),
  since: Timestamp,
});
export type TrackingProblemDto = z.infer<typeof TrackingProblemDto>;

/** Where one of my characters is, from tracking; null fields are unknown (never tracked yet). */
export const CharacterLocationDto = z.object({
  characterId: EveId,
  solarSystemId: EveId.nullable(),
  shipTypeId: EveId.nullable(),
  shipName: z.string().nullable(),
  /** Null until tracking asked ESI. */
  online: z.boolean().nullable(),
  docked: z.boolean().nullable(),
  updatedAt: Timestamp.nullable(),
  /** Maps the character is tracked on. */
  trackedOn: z.array(Id),
  /** Set while tracking cannot read the character's location; absent while it can. */
  problem: TrackingProblemDto.optional(),
});
export type CharacterLocationDto = z.infer<typeof CharacterLocationDto>;

/** A map one of my characters can be tracked on (the cross-map tracking page). */
export const TrackableMapDto = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  /** Members and up may track their characters there. */
  canTrack: z.boolean(),
});
export type TrackableMapDto = z.infer<typeof TrackableMapDto>;

/** GET /api/accounts/me/tracking: my characters' whereabouts and every map they may be tracked on. */
export const MyTrackingDto = z.object({
  characters: z.array(CharacterLocationDto),
  maps: z.array(TrackableMapDto),
});
export type MyTrackingDto = z.infer<typeof MyTrackingDto>;

/** GET /api/accounts/me/characters/:characterId/wallet (wallet extra granted). */
export const CharacterWalletDto = z.object({
  characterId: EveId,
  /** ISK; null when ESI did not answer. */
  balance: z.number().nullable(),
  checkedAt: Timestamp,
});
export type CharacterWalletDto = z.infer<typeof CharacterWalletDto>;

/** My own settings on one map: the main character there and the one the map follows. */
export const MapTrackingSettingsDto = z.object({
  /** Overrides the account's main on this map; null uses the account's main. */
  mainCharacterId: EveId.nullable(),
  /** The map selects this character's system whenever it jumps; null follows nobody. */
  followCharacterId: EveId.nullable(),
});
export type MapTrackingSettingsDto = z.infer<typeof MapTrackingSettingsDto>;

/** PUT /api/maps/:mapId/tracking/me: fields left out keep their value. */
export const UpdateMapTrackingSettingsRequest = MapTrackingSettingsDto.partial();
export type UpdateMapTrackingSettingsRequest = z.infer<typeof UpdateMapTrackingSettingsRequest>;

export const ActivityPeriod = z.enum(['30d', '1y', 'all']);
export type ActivityPeriod = z.infer<typeof ActivityPeriod>;

/** GET /api/maps/:mapId/tracking/activity?period= */
export const CharacterActivityQuery = z.object({ period: ActivityPeriod.default('30d') });
export type CharacterActivityQuery = z.infer<typeof CharacterActivityQuery>;

/** What one character did on a map in the period, from the map's history. */
export const CharacterActivityDto = z.object({
  characterId: EveId,
  name: z.string().nullable(),
  /** Jumps tracked on this map. */
  jumps: z.number().int().nonnegative(),
  /** Systems, connections and signatures added with this character. */
  systems: z.number().int().nonnegative(),
  connections: z.number().int().nonnegative(),
  signatures: z.number().int().nonnegative(),
});
export type CharacterActivityDto = z.infer<typeof CharacterActivityDto>;

/** GET /api/tracking/online: characters online per map I can see (the maps list). */
export const OnlineCountsDto = z.object({ counts: z.record(z.string(), z.number().int().nonnegative()) });
export type OnlineCountsDto = z.infer<typeof OnlineCountsDto>;

/** GET /api/eve/status: Tranquility as ESI `/status` last said. */
export const EveServerStatusDto = z.object({
  /** True while TQ answers with players; false when it is down or in VIP; null when unknown. */
  online: z.boolean().nullable(),
  players: z.number().int().nonnegative().nullable(),
  /** Only developers may log in (around downtime). */
  vip: z.boolean(),
  serverVersion: z.string().nullable(),
  /** When TQ last started (epoch ms). */
  startedAt: Timestamp.nullable(),
  checkedAt: Timestamp.nullable(),
  /** Tracking waits while TQ is down or in VIP. */
  trackingPaused: z.boolean(),
});
export type EveServerStatusDto = z.infer<typeof EveServerStatusDto>;

/**
 * Per-person options kept on the server (the "My preferences" surface): one JSON object per
 * area (`local`, `sidebar`, `signatures`, `canvas`, ...). Each area's owner validates its own.
 */
export const UserPreferencesDto = z.object({
  preferences: z.record(z.string(), z.unknown()),
  updatedAt: Timestamp,
});
export type UserPreferencesDto = z.infer<typeof UserPreferencesDto>;

/** PUT /api/accounts/me/preferences: replaces the areas given (null removes one). */
export const UpdateUserPreferencesRequest = z.object({
  preferences: z.record(z.string().min(1).max(40), z.unknown().nullable()),
});
export type UpdateUserPreferencesRequest = z.infer<typeof UpdateUserPreferencesRequest>;
