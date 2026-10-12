import type { MapRole } from '@darkbeacon/shared';
import type { ReportBuilder } from './report.js';
import type { WandererAcl } from './wanderer.js';

/** A Wanderer ACL member as a Darkbeacon access rule on the map. */
export interface PlannedAccessRule {
  /** `<kind>:<eve id>`: one rule per subject, as Darkbeacon keeps them. */
  key: string;
  subjectKind: 'character' | 'corporation' | 'alliance';
  subjectId: string;
  role: MapRole;
  /** The strongest Wanderer role among the ACLs that list it. */
  wandererRole: string;
  wandererName: string | null;
  acls: string[];
  note: string | null;
}

/**
 * Wanderer ACL roles and the map roles they become. Both mappers grant the same five levels:
 * admin (settings and access), manager, member (edits the chain), viewer and blocked. Nothing
 * here can make anyone an instance admin: access rules only grant map roles.
 */
export const ROLE_MAP: Record<string, MapRole> = {
  admin: 'admin',
  manager: 'manager',
  member: 'member',
  viewer: 'viewer',
  blocked: 'blocked',
};

const RANK: Record<MapRole, number> = { blocked: -1, viewer: 0, member: 1, manager: 2, admin: 3 };

/**
 * One rule per subject from every ACL of the map. A subject in several ACLs gets the strongest
 * role; a block on a character beats any grant (as in Darkbeacon, where it is decisive), while a
 * block on a corporation or alliance yields to grants from other ACLs.
 */
export function planAccess(acls: readonly WandererAcl[], report: ReportBuilder): PlannedAccessRule[] {
  const rules = new Map<string, PlannedAccessRule>();
  for (const acl of acls) {
    if (acl.members === null) {
      report.dropped(
        'access',
        `Members of the ACL “${acl.name}”`,
        acl.error ?? 'The map API key cannot read them; add the ACL API key of that list',
        acl.name,
      );
      continue;
    }
    for (const member of acl.members) {
      const role = ROLE_MAP[member.role];
      const label = member.name ?? `${member.kind} ${member.eveId}`;
      if (!role) {
        report.dropped('access', `Role “${member.role}”`, 'Darkbeacon has no such map role', label);
        continue;
      }
      const key = `${member.kind}:${member.eveId}`;
      const existing = rules.get(key);
      if (!existing) {
        rules.set(key, {
          key,
          subjectKind: member.kind,
          subjectId: member.eveId,
          role,
          wandererRole: member.role,
          wandererName: member.name,
          acls: [acl.name],
          note: null,
        });
        continue;
      }
      existing.acls.push(acl.name);
      existing.wandererName ??= member.name;
      const decisiveBlock =
        member.kind === 'character' && (role === 'blocked' || existing.role === 'blocked');
      const next = decisiveBlock ? 'blocked' : RANK[role] > RANK[existing.role] ? role : existing.role;
      if (next !== existing.role || existing.role !== role) {
        existing.note = decisiveBlock
          ? 'Blocked in one ACL: a block on a character beats every grant'
          : `In several ACLs; the strongest role (${next}) wins`;
      }
      existing.role = next;
      existing.wandererRole = next;
    }
  }
  const out = [...rules.values()].sort(
    (a, b) =>
      RANK[b.role] - RANK[a.role] || a.subjectKind.localeCompare(b.subjectKind) || a.key.localeCompare(b.key),
  );
  for (const rule of out) {
    if (rule.role === 'blocked' && rule.subjectKind !== 'character') {
      rule.note ??= 'A block on a corporation or alliance yields to any grant in Darkbeacon';
      report.approximated(
        'access',
        'Block on a corporation or alliance',
        'In Darkbeacon it yields to a grant from another rule',
        rule.wandererName ?? rule.key,
      );
    } else
      report.mapped(
        'access',
        `${titleCase(rule.subjectKind)} as ${rule.role}`,
        rule.wandererName ?? rule.key,
      );
  }
  return out;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
