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
