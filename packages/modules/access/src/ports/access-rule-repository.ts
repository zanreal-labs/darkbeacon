import type { AccessRule } from '../domain/access-rule.js';

export interface AccessRuleRepository {
  listForMap(mapId: string): Promise<AccessRule[]>;
  findById(ruleId: string): Promise<AccessRule | null>;
  insert(rule: AccessRule): Promise<void>;
  delete(ruleId: string): Promise<void>;
  /** Rules that could match these subjects, across all maps (for "which maps can I see"). */
  listMatching(subjects: { kind: AccessRule['subjectKind']; id: string }[]): Promise<AccessRule[]>;
}
