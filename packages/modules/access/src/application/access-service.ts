import {
  hasMapRole,
  requireMapRole,
  resolveMapRole,
  type Actor,
  type GrantingMapRole,
  type MapAccess,
  type MapRole,
} from '@wormwright/core';
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
 * - Otherwise access rules decide: a block on one of the account's characters or on the account
 *   wins, then the highest granted role, then `blocked` if only blocks matched.
 * - API tokens hold a fixed role on one map; system and plugin actors act as admin.
 * - Instance owners and admins get no implicit map access.
 */
export class AccessService implements MapAccess {
  constructor(private readonly deps: AccessServiceDeps) {}

  async roleOf(actor: Actor, mapId: string): Promise<MapRole | null> {
    const owner = await this.deps.ownership.ownerOf(mapId);
    if (owner === null) return null;
    switch (actor.kind) {
      case 'system':
      case 'plugin':
        return 'admin';
      case 'apiToken':
        return actor.mapId === mapId ? actor.role : null;
      case 'account': {
        if (owner === actor.id) return 'admin';
        const [rules, subjects] = await Promise.all([
          this.deps.rules.listForMap(mapId),
          this.deps.subjects.subjectsOf(actor.id),
        ]);
        return resolveMapRole(grantsFor(rules, subjects));
      }
    }
  }

  async mapsFor(actor: Actor): Promise<Array<{ mapId: string; role: GrantingMapRole }>> {
    if (actor.kind === 'apiToken') {
      const role = await this.roleOf(actor, actor.mapId);
      return hasMapRole(role, 'viewer') ? [{ mapId: actor.mapId, role: actor.role }] : [];
    }
    if (actor.kind !== 'account') return [];

    const [owned, subjects] = await Promise.all([
      this.deps.ownership.mapsOwnedBy(actor.id),
      this.deps.subjects.subjectsOf(actor.id),
    ]);
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
