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
   * Whether imports may read Wanderer instances on private and local networks (and over plain
   * http), e.g. a self-hosted Wanderer next to this server. Off by default.
   */
  importsFromPrivateNetworks: z.boolean().optional(),
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
  importsFromPrivateNetworks: z.boolean().optional(),
});
export type UpdateInstanceSettingsRequest = z.infer<typeof UpdateInstanceSettingsRequest>;
