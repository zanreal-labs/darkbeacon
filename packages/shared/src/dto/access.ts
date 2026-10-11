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
  /** Theme used when neither the user nor the map picks one. */
  defaultTheme: z.string().min(1).max(64),
  /** Discord guild whose roles can make an account an instance admin. */
  adminGuildId: z.string().nullable(),
  /** Roles on `adminGuildId` that grant instance admin. */
  adminRoleIds: z.array(z.string()),
});
export type InstanceSettingsDto = z.infer<typeof InstanceSettingsDto>;

const Snowflake = z.string().regex(/^\d{1,20}$/, 'must be a Discord id');

export const UpdateInstanceSettingsRequest = z.object({
  defaultTheme: z.string().trim().min(1).max(64).optional(),
  adminGuildId: Snowflake.nullable().optional(),
  adminRoleIds: z.array(Snowflake).max(50).optional(),
});
export type UpdateInstanceSettingsRequest = z.infer<typeof UpdateInstanceSettingsRequest>;
