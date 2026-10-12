import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const MapRole = z.enum(['blocked', 'viewer', 'member', 'manager', 'admin']);
export type MapRole = z.infer<typeof MapRole>;

export const AccessSubjectKind = z.enum(['discordRole', 'character', 'corporation', 'alliance', 'account']);
export type AccessSubjectKind = z.infer<typeof AccessSubjectKind>;

export const AccessRuleDto = z.object({
  id: Id,
  mapId: Id,
  subjectKind: AccessSubjectKind,
  /** Discord role id, EVE id (as a string) or account id, depending on `subjectKind`. */
  subjectId: z.string().min(1),
  /** Discord guild of a `discordRole` subject, null otherwise. */
  guildId: z.string().nullable(),
  role: MapRole,
  createdAt: Timestamp,
  /**
   * Who the rule is about, by name: the character, corporation or alliance (with its ticker), the
   * account, or the Discord role (with its server). Filled in where it could be looked up; the
   * web app shows it instead of the raw id.
   */
  subject: z
    .object({
      name: z.string(),
      /** Ticker, Discord server name... */
      detail: z.string().nullable(),
      imageUrl: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type AccessRuleDto = z.infer<typeof AccessRuleDto>;

export const CreateAccessRuleRequest = z
  .object({
    subjectKind: AccessSubjectKind,
    subjectId: z.string().trim().min(1),
    guildId: z.string().trim().min(1).nullable().optional(),
    role: MapRole,
  })
  .refine((r) => r.subjectKind !== 'discordRole' || !!r.guildId, {
    message: 'guildId is required for a Discord role',
    path: ['guildId'],
  });
export type CreateAccessRuleRequest = z.infer<typeof CreateAccessRuleRequest>;

/** Who may create maps on the instance (Wanderer's env flag, here an admin setting). */
export const MapCreation = z.enum(['everyone', 'admins']);
export type MapCreation = z.infer<typeof MapCreation>;

/**
 * Who may sign up (create an account by signing in for the first time). `open`: anyone, as
 * before. `restricted`: only people with a character in one of the corporations or alliances,
 * a member of one of the Discord servers, or someone holding an invite link.
 */
export const SignInPolicy = z.object({
  mode: z.enum(['open', 'restricted']),
  corporationIds: z.array(z.number().int().positive()).max(200).default([]),
  allianceIds: z.array(z.number().int().positive()).max(200).default([]),
  guildIds: z
    .array(z.string().regex(/^\d{1,20}$/))
    .max(50)
    .default([]),
});
export type SignInPolicy = z.infer<typeof SignInPolicy>;

/** Instance-wide settings kept in the database and edited in the admin tab. */
export const InstanceSettingsDto = z.object({
  /** Discord guild whose roles can make an account an instance admin. */
  adminGuildId: z.string().nullable(),
  /** Roles on `adminGuildId` that grant instance admin. */
  adminRoleIds: z.array(z.string()),
  /** Whether webhooks may target loopback, private and link-local addresses (off by default). */
  webhooksToPrivateNetworks: z.boolean(),
  /**
   * Days the event log (which is also the audit trail) is kept; null keeps everything (default).
   * Replay and webhook delivery are unaffected: they read only recent events.
   */
  eventRetentionDays: z.number().int().positive().nullable(),
  /**
   * How people sign in. Stored as chosen; the effective method is `eve` whenever Discord is not
   * configured (see `AuthProvidersDto.loginMethod`). Null: the default (Discord when configured).
   */
  loginMethod: z.enum(['discord', 'eve']).nullable().optional(),
  /** The map `/` opens for everyone who has not starred a map of their own. */
  defaultMapId: Id.nullable().optional(),
  /**
   * The MCP endpoint for AI agents (`/mcp`): `off` (default), `authenticated` (API keys only) or
   * `public` (also anonymous, read-only, for public maps that allow it). Maps narrow it further.
   */
  mcpMode: z.enum(['off', 'authenticated', 'public']).optional(),
  /**
   * Origins that may call the REST API from a browser (CORS) with an API key. Cookies are never
   * accepted cross-origin; empty (default): no cross-origin access.
   */
  apiCorsOrigins: z.array(z.string()).optional(),
  /** Whether map admins may make maps public (`/p/<token>`); on by default. */
  publicMaps: z.boolean().optional(),
  /** Who may create maps: everyone (default) or instance admins only. */
  mapCreation: MapCreation.optional(),
  /**
   * The instance API switch: when off, API keys, OAuth tokens and the MCP endpoint are refused
   * (browser sessions keep working). On by default.
   */
  apiAccess: z.boolean().optional(),
  /** When off, no webhook of any map is delivered (they keep their settings). On by default. */
  webhooksEnabled: z.boolean().optional(),
  /** Who may sign up; existing accounts always sign in unless disabled. */
  signIn: SignInPolicy.optional(),
});
export type InstanceSettingsDto = z.infer<typeof InstanceSettingsDto>;

const Snowflake = z.string().regex(/^\d{1,20}$/, 'must be a Discord id');

export const UpdateInstanceSettingsRequest = z.object({
  adminGuildId: Snowflake.nullable().optional(),
  adminRoleIds: z.array(Snowflake).max(50).optional(),
  webhooksToPrivateNetworks: z.boolean().optional(),
  eventRetentionDays: z.number().int().min(1).max(36_500).nullable().optional(),
  loginMethod: z.enum(['discord', 'eve']).nullable().optional(),
  defaultMapId: Id.nullable().optional(),
  mcpMode: z.enum(['off', 'authenticated', 'public']).optional(),
  apiCorsOrigins: z
    .array(
      z
        .string()
        .regex(
          /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/,
          'expected an origin such as https://tools.example.com',
        ),
    )
    .max(20)
    .optional(),
  publicMaps: z.boolean().optional(),
  mapCreation: MapCreation.optional(),
  apiAccess: z.boolean().optional(),
  webhooksEnabled: z.boolean().optional(),
  signIn: SignInPolicy.optional(),
});
export type UpdateInstanceSettingsRequest = z.infer<typeof UpdateInstanceSettingsRequest>;
