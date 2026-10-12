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
 * One rule per subject from every ACL of the map. A subject blocked in any ACL stays blocked, as
 * in Wanderer, whatever its kind; otherwise the strongest role wins. Darkbeacon resolves blocks
 * the way Wanderer does (a block on a corporation or alliance beats every group grant, only a
 * character grant gets past it), so blocks come over 1:1.
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
      const blocked = role === 'blocked' || existing.role === 'blocked';
      const next = blocked ? 'blocked' : RANK[role] > RANK[existing.role] ? role : existing.role;
      if (next !== existing.role || existing.role !== role) {
        existing.note = blocked
          ? 'Blocked in one ACL: a block beats every grant of the same subject'
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
    if (rule.role === 'blocked' && rule.subjectKind !== 'character')
      rule.note ??= 'Beats every corporation and alliance grant; only a character grant gets past it';
    report.mapped('access', `${titleCase(rule.subjectKind)} as ${rule.role}`, rule.wandererName ?? rule.key);
  }
  return out;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
