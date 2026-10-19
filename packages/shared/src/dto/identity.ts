import { z } from 'zod';
import { OptionalEveScope } from './characters.js';
import { EveId, Id, Timestamp } from './common.js';

export const InstanceRole = z.enum(['owner', 'admin', 'user']);
export type InstanceRole = z.infer<typeof InstanceRole>;

export const AccountDto = z.object({
  id: Id,
  discordId: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  instanceRole: InstanceRole,
  /** The character the account acts as by default (presence, pings); null until chosen. */
  mainCharacterId: EveId.nullable().optional(),
  /** The map `/` opens for this account (starred); null when none was chosen. */
  defaultMapId: Id.nullable().optional(),
  /** Maps this account opened, most recent first (at most five). */
  recentMapIds: z.array(Id).optional(),
  createdAt: Timestamp,
});
export type AccountDto = z.infer<typeof AccountDto>;

export const CharacterDto = z.object({
  id: EveId,
  name: z.string(),
  corporationId: EveId,
  allianceId: EveId.nullable(),
  /** False when the stored EVE token no longer works and the character must be re-linked. */
  tokenValid: z.boolean(),
  /** True when the token allows ESI search (pickers); characters linked before it was asked lack it. */
  canSearch: z.boolean().optional(),
  linkedAt: Timestamp,
  /** The character's EVE grant allows setting the in-game destination (`esi-ui.write_waypoint.v1`). */
  canSetWaypoints: z.boolean().optional(),
  /**
   * Required ESI scopes the character's grant lacks (linked before Darkbeacon asked for them):
   * linking it again adds them. Absent when unknown (characters without an EVE grant).
   */
  missingScopes: z.array(z.string()).optional(),
  /** Opt-in scopes the grant holds (`assets`, `wallet`, `structures`, `jumps`). */
  extras: z.array(OptionalEveScope).optional(),
});
export type CharacterDto = z.infer<typeof CharacterDto>;

/** GET /api/accounts/me */
export const MeDto = z.object({
  account: AccountDto,
  characters: z.array(CharacterDto),
});
export type MeDto = z.infer<typeof MeDto>;

/** PUT /api/accounts/me/main-character */
export const SetMainCharacterRequest = z.object({ characterId: EveId });
export type SetMainCharacterRequest = z.infer<typeof SetMainCharacterRequest>;

/**
 * POST /api/auth/dev (demo mode only): signs in a named local account, for scripts and tests that
 * need several people. The web app uses POST /api/auth/demo instead.
 */
export const DevLoginRequest = z.object({
  name: z.string().trim().min(1).max(64),
  character: z
    .object({
      name: z.string().trim().min(1).max(64),
      id: EveId.optional(),
      corporationId: EveId.optional(),
      allianceId: EveId.nullable().optional(),
    })
    .optional(),
});
export type DevLoginRequest = z.infer<typeof DevLoginRequest>;

/** How people sign in to this instance: their Discord user, or their EVE characters. */
export const LoginMethod = z.enum(['discord', 'eve']);
export type LoginMethod = z.infer<typeof LoginMethod>;

/** GET /api/auth/providers: which login buttons the web app shows. */
export const AuthProvidersDto = z.object({
  discord: z.boolean(),
  eve: z.boolean(),
  /**
   * The way in the sign-in page offers: `eve` when Discord is not configured, otherwise the
   * instance setting (Discord by default).
   */
  loginMethod: LoginMethod,
  /** Demo mode: unauthenticated visits are signed in as the demo account (POST /api/auth/demo). */
  demo: z.boolean(),
  /** The Discord OAuth redirect this instance uses (from PUBLIC_URL), for admins setting it up. */
  discordRedirectUrl: z.string(),
});
export type AuthProvidersDto = z.infer<typeof AuthProvidersDto>;

export const AdminAccountDto = AccountDto.extend({
  lastSeenAt: Timestamp.nullable(),
  /** Set while an instance admin has disabled the account (optional: added later). */
  disabledAt: Timestamp.nullable().optional(),
  disabledReason: z.string().nullable().optional(),
});
export type AdminAccountDto = z.infer<typeof AdminAccountDto>;

export const UpdateInstanceRoleRequest = z.object({ role: z.enum(['admin', 'user']) });
export type UpdateInstanceRoleRequest = z.infer<typeof UpdateInstanceRoleRequest>;

export const TransferOwnershipRequest = z.object({ accountId: Id });
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequest>;

/** PUT /api/accounts/me/default-map: the map `/` opens (null clears it). */
export const SetDefaultMapRequest = z.object({ mapId: Id.nullable() });
export type SetDefaultMapRequest = z.infer<typeof SetDefaultMapRequest>;

/** PUT /api/accounts/me/recent-map: the map this account just opened. */
export const RecordMapOpenedRequest = z.object({ mapId: Id });
export type RecordMapOpenedRequest = z.infer<typeof RecordMapOpenedRequest>;

/** GET /api/accounts/me/landing: where `/` sends the account (slug null: it can see no map). */
export const LandingDto = z.object({
  slug: z.string().nullable(),
  /** Why this map: the account's star, the instance default, the last opened, or the only one. */
  reason: z.enum(['account', 'instance', 'recent', 'only', 'first']).nullable(),
});
export type LandingDto = z.infer<typeof LandingDto>;

/** One signed-in browser or device of the account. */
export const SessionDto = z.object({
  /** Opaque handle for revoking; neither the cookie nor its stored hash. */
  id: z.string(),
  /** "Firefox", "Chrome", ... or null when the browser did not say. */
  browser: z.string().nullable(),
  /** "macOS", "Windows", "iPhone", ... */
  os: z.string().nullable(),
  device: z.enum(['desktop', 'mobile', 'tablet', 'unknown']),
  createdAt: Timestamp,
  lastSeenAt: Timestamp,
  /** The session this request was made with. */
  current: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionDto>;

/** GET /api/accounts/search?q=: accounts by name, for map admins picking people. */
export const AccountSearchQuery = z.object({ q: z.string().trim().min(1).max(64) });
export type AccountSearchQuery = z.infer<typeof AccountSearchQuery>;

export const AccountSummaryDto = z.object({
  id: Id,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  mainCharacterId: EveId.nullable(),
});
export type AccountSummaryDto = z.infer<typeof AccountSummaryDto>;

/** GET /api/instance: what signed-in pages need to know about the instance. */
export const InstanceInfoDto = z.object({
  /** The map admins chose for everyone who has not starred one. */
  defaultMapId: Id.nullable(),
  loginMethod: LoginMethod,
  /** Discord roles can grant map access and instance admin (Discord sign-in only). */
  discordRoles: z.boolean(),
  /** A Discord bot is connected: servers, roles and channels are picked from lists. */
  discordBot: z.boolean(),
  /** Map admins may make maps public (optional: added later). */
  publicMaps: z.boolean().optional(),
  /** How far AI agents reach the instance (`/mcp`); optional: added later. */
  mcpMode: z.enum(['off', 'authenticated', 'public']).optional(),
  /** Who may create maps (optional: added later; absent means everyone). */
  mapCreation: z.enum(['everyone', 'admins']).optional(),
});
export type InstanceInfoDto = z.infer<typeof InstanceInfoDto>;
