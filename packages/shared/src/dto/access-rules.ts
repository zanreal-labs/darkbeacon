import { z } from 'zod';
import { MapRole } from './access.js';
import { Id } from './common.js';

/**
 * Roles map managers may hand out, change and take back (as in Wanderer, where managers manage
 * members, viewers and blocks of a list but never its admins and managers).
 */
export const MANAGER_ASSIGNABLE_ROLES = ['viewer', 'member', 'blocked'] as const satisfies readonly MapRole[];

/** PATCH /api/maps/:mapId/access-rules/:ruleId: the rule keeps its subject, only the role changes. */
export const UpdateAccessRuleRequest = z.object({ role: MapRole });
export type UpdateAccessRuleRequest = z.infer<typeof UpdateAccessRuleRequest>;

/**
 * POST /api/maps/:mapId/access-rules/copy: the rules of another map the caller manages, added to
 * this one. Subjects this map already has a rule for keep it unless `overwrite`.
 */
export const CopyAccessRulesRequest = z.object({
  fromMapId: Id,
  overwrite: z.boolean().default(false),
});
export type CopyAccessRulesRequest = z.infer<typeof CopyAccessRulesRequest>;

export const CopyAccessRulesResultDto = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  /** Rules left alone: the subject already had one here (or it was the same). */
  skipped: z.number().int(),
});
export type CopyAccessRulesResultDto = z.infer<typeof CopyAccessRulesResultDto>;

/**
 * A rule made with a new map: the creator's own corporation or alliance (one of their characters'
 * corporations or alliances), as Wanderer's "create default access list" does for its owner.
 */
export const StarterAccessRule = z.object({
  subjectKind: z.enum(['corporation', 'alliance']),
  subjectId: z.string().regex(/^[1-9]\d{0,18}$/, 'must be an EVE id'),
  role: MapRole.exclude(['blocked', 'admin']).default('member'),
});
export type StarterAccessRule = z.infer<typeof StarterAccessRule>;
