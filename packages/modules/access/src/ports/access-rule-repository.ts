import type { AccessRule } from '../domain/access-rule.js';

export interface AccessRuleRepository {
  listForMap(mapId: string): Promise<AccessRule[]>;
  findById(ruleId: string): Promise<AccessRule | null>;
  /** Fails on a second rule for the same map and subject. */
  insert(rule: AccessRule): Promise<void>;
  updateRole(ruleId: string, role: AccessRule['role']): Promise<void>;
  delete(ruleId: string): Promise<void>;
  /** How many rules each map has (the admin's map inventory). */
  countByMap(): Promise<Map<string, number>>;
  /** Rules that could match these subjects, across all maps (for "which maps can I see"). */
  listMatching(subjects: { kind: AccessRule['subjectKind']; id: string }[]): Promise<AccessRule[]>;
  /** Distinct guilds referenced by Discord role rules. */
  discordGuildIds(): Promise<string[]>;
}
