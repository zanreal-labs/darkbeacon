import {
  capMapRole,
  hasMapRole,
  requireMapRole,
  resolveMapRole,
  type Actor,
  type GrantingMapRole,
  type MapAccess,
  type MapRole,
} from '@darkbeacon/core';
import { grantsFor, subjectKeys, type AccessRule } from '../domain/access-rule.js';
import type { AccessRuleRepository } from '../ports/access-rule-repository.js';
import type { AccessSubjectsSource, MapOwnership } from '../ports/access-subjects.js';

export interface AccessServiceDeps {
  rules: AccessRuleRepository;
  subjects: AccessSubjectsSource;
  ownership: MapOwnership;
}

/**
 * The authorization service every module uses for maps (the core `MapAccess` port).
 *
 * - The map owner is always admin.
 * - Otherwise access rules decide, as in Wanderer: a block on one of the account's characters or
 *   on the account wins; a block on a corporation, alliance or Discord role beats every group
 *   grant, so only character and account grants get past it; else the highest granted role.
 * - Service keys hold the roles an instance admin gave them; a public visitor is a viewer of
 *   the one map whose link it came through; system and plugin actors act as admin.
 * - Instance owners and admins get no implicit map access.
 * - A credential (API key, MCP client) lowers the role to what its scopes allow (`capMapRole`).
 */
export class AccessService implements MapAccess {
  constructor(private readonly deps: AccessServiceDeps) {}

  async roleOf(actor: Actor, mapId: string): Promise<MapRole | null> {
    return capMapRole(actor, mapId, await this.ownRole(actor, mapId));
  }

  /** The principal's own role, before any credential narrows it. */
  private async ownRole(actor: Actor, mapId: string): Promise<MapRole | null> {
    const owner = await this.deps.ownership.ownerOf(mapId);
    if (owner === null) return null;
    switch (actor.kind) {
      case 'system':
      case 'plugin':
        return 'admin';
      case 'apiToken':
        return actor.roles.maps[mapId] ?? actor.roles.allMaps;
      case 'public':
        return actor.mapId === mapId ? 'viewer' : null;
      case 'account': {
        const [rules, subjects] = await Promise.all([
          this.deps.rules.listForMap(mapId),
          this.deps.subjects.subjectsOf(actor.id),
        ]);
        if (subjects.disabled) return null;
        if (owner === actor.id) return 'admin';
        return resolveMapRole(grantsFor(rules, subjects));
      }
    }
  }

  async mapsFor(actor: Actor): Promise<Array<{ mapId: string; role: GrantingMapRole }>> {
    const capped = (list: Array<{ mapId: string; role: GrantingMapRole }>) =>
      list.flatMap(({ mapId, role }) => {
        const effective = capMapRole(actor, mapId, role);
        return hasMapRole(effective, 'viewer') ? [{ mapId, role: effective as GrantingMapRole }] : [];
      });
    if (actor.kind === 'public') {
      return hasMapRole(await this.roleOf(actor, actor.mapId), 'viewer')
        ? [{ mapId: actor.mapId, role: 'viewer' }]
        : [];
    }
    if (actor.kind === 'apiToken') {
      const ids =
        actor.roles.allMaps !== null
          ? ((await this.deps.ownership.allMaps?.()) ?? [])
          : Object.keys(actor.roles.maps);
      const result: Array<{ mapId: string; role: GrantingMapRole }> = [];
      for (const mapId of ids) {
        const role = await this.ownRole(actor, mapId);
        if (hasMapRole(role, 'viewer')) result.push({ mapId, role: role as GrantingMapRole });
      }
      return capped(result);
    }
    if (actor.kind !== 'account') return [];
    return capped(await this.accountMaps(actor.id));
  }

  private async accountMaps(accountId: string): Promise<Array<{ mapId: string; role: GrantingMapRole }>> {
    const [owned, subjects] = await Promise.all([
      this.deps.ownership.mapsOwnedBy(accountId),
      this.deps.subjects.subjectsOf(accountId),
    ]);
    if (subjects.disabled) return [];
    const result = owned.map((mapId) => ({ mapId, role: 'admin' as GrantingMapRole }));
    const byMap = new Map<string, AccessRule[]>();
    for (const rule of await this.deps.rules.listMatching(subjectKeys(subjects))) {
      if (owned.includes(rule.mapId)) continue;
      byMap.set(rule.mapId, [...(byMap.get(rule.mapId) ?? []), rule]);
    }
    for (const [mapId, rules] of byMap) {
      const role = resolveMapRole(grantsFor(rules, subjects));
      // Rules outlive deleted maps; only report maps that still exist.
      if (hasMapRole(role, 'viewer') && (await this.deps.ownership.ownerOf(mapId)) !== null) {
        result.push({ mapId, role: role as GrantingMapRole });
      }
    }
    return result;
  }

  /** Throws unless the actor has at least `min`; maps it cannot view are reported as not found. */
  require(actor: Actor | null, mapId: string, min: GrantingMapRole): Promise<MapRole> {
    return requireMapRole(this, actor, mapId, min);
  }
}
