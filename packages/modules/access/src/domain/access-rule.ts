import { err, ok, type MapRole, type Result, type RoleGrant } from '@wormwright/core';
import type { AccessRuleDto, AccessSubjectKind } from '@wormwright/shared';

/** Grants `role` on a map to everyone matching the subject. */
export interface AccessRule {
  id: string;
  mapId: string;
  subjectKind: AccessSubjectKind;
  subjectId: string;
  guildId: string | null;
  role: MapRole;
  createdAt: number;
  createdBy: string;
}

/** Everything an account can be matched by. */
export interface AccessSubjects {
  accountId: string;
  characterIds: number[];
  corporationIds: number[];
  allianceIds: number[];
  discordRoles: Array<{ guildId: string; roleId: string }>;
}

/** Subject keys of an account, as (kind, id) pairs for `AccessRuleRepository.listMatching`. */
export function subjectKeys(subjects: AccessSubjects): Array<{ kind: AccessSubjectKind; id: string }> {
  return [
    { kind: 'account', id: subjects.accountId },
    ...subjects.characterIds.map((id) => ({ kind: 'character' as const, id: String(id) })),
    ...subjects.corporationIds.map((id) => ({ kind: 'corporation' as const, id: String(id) })),
    ...subjects.allianceIds.map((id) => ({ kind: 'alliance' as const, id: String(id) })),
    ...subjects.discordRoles.map((r) => ({ kind: 'discordRole' as const, id: r.roleId })),
  ];
}

export function ruleMatches(rule: AccessRule, subjects: AccessSubjects): boolean {
  switch (rule.subjectKind) {
    case 'account':
      return rule.subjectId === subjects.accountId;
    case 'character':
      return subjects.characterIds.some((id) => String(id) === rule.subjectId);
    case 'corporation':
      return subjects.corporationIds.some((id) => String(id) === rule.subjectId);
    case 'alliance':
      return subjects.allianceIds.some((id) => String(id) === rule.subjectId);
    case 'discordRole':
      return subjects.discordRoles.some((r) => r.roleId === rule.subjectId && r.guildId === rule.guildId);
  }
}

/** A block on one of the account's characters, or on the account itself, beats every grant. */
export function isDecisiveBlock(rule: AccessRule): boolean {
  return rule.role === 'blocked' && (rule.subjectKind === 'character' || rule.subjectKind === 'account');
}

export function grantsFor(rules: readonly AccessRule[], subjects: AccessSubjects): RoleGrant[] {
  return rules
    .filter((rule) => ruleMatches(rule, subjects))
    .map((rule) => ({ role: rule.role, decisive: isDecisiveBlock(rule) }));
}

const EVE_ID = /^[1-9]\d{0,18}$/;
const SNOWFLAKE = /^\d{1,20}$/;

/** Normalizes and checks the subject of a new rule. */
export function parseSubject(input: {
  subjectKind: AccessSubjectKind;
  subjectId: string;
  guildId?: string | null | undefined;
}): Result<{ subjectId: string; guildId: string | null }> {
  const subjectId = input.subjectId.trim();
  switch (input.subjectKind) {
    case 'character':
    case 'corporation':
    case 'alliance':
      return EVE_ID.test(subjectId)
        ? ok({ subjectId, guildId: null })
        : err('subjectId must be a numeric EVE id');
    case 'account':
      return subjectId.length > 0 ? ok({ subjectId, guildId: null }) : err('subjectId must be an account id');
    case 'discordRole': {
      const guildId = input.guildId?.trim() ?? '';
      if (!SNOWFLAKE.test(subjectId)) return err('subjectId must be a Discord role id');
      if (!SNOWFLAKE.test(guildId)) return err('guildId must be a Discord guild id');
      return ok({ subjectId, guildId });
    }
  }
}

export function toAccessRuleDto(rule: AccessRule): AccessRuleDto {
  return {
    id: rule.id,
    mapId: rule.mapId,
    subjectKind: rule.subjectKind,
    subjectId: rule.subjectId,
    guildId: rule.guildId,
    role: rule.role,
    createdAt: rule.createdAt,
  };
}
