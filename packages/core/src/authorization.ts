import type { ActorRef } from './events.js';
import { ForbiddenError, UnauthenticatedError } from './errors.js';

export type InstanceRole = 'owner' | 'admin' | 'user';
export type MapRole = 'blocked' | 'viewer' | 'member' | 'manager' | 'admin';
/** Roles that grant something; `blocked` is handled separately. */
export type GrantingMapRole = Exclude<MapRole, 'blocked'>;

export const INSTANCE_ROLES: readonly InstanceRole[] = ['user', 'admin', 'owner'];
export const MAP_ROLES: readonly MapRole[] = ['blocked', 'viewer', 'member', 'manager', 'admin'];

const instanceRank: Record<InstanceRole, number> = { user: 0, admin: 1, owner: 2 };
const mapRank: Record<GrantingMapRole, number> = { viewer: 0, member: 1, manager: 2, admin: 3 };

/** The authenticated caller of a use case. */
export type Actor =
  | { kind: 'account'; id: string; instanceRole: InstanceRole }
  | { kind: 'apiToken'; id: string; mapId: string; role: GrantingMapRole }
  | { kind: 'system'; id: string }
  | { kind: 'plugin'; id: string };

export type AccountActor = Extract<Actor, { kind: 'account' }>;

export function actorRef(actor: Actor): ActorRef {
  return { kind: actor.kind, id: actor.id };
}

export function hasInstanceRole(role: InstanceRole, min: InstanceRole): boolean {
  return instanceRank[role] >= instanceRank[min];
}

export function isInstanceAdmin(actor: Actor | null): boolean {
  return actor?.kind === 'account' && hasInstanceRole(actor.instanceRole, 'admin');
}

/** True when `role` grants at least `min`. `blocked` and `null` grant nothing. */
export function hasMapRole(role: MapRole | null, min: GrantingMapRole): boolean {
  return role !== null && role !== 'blocked' && mapRank[role] >= mapRank[min];
}

export interface RoleGrant {
  role: MapRole;
  /** A `blocked` grant on a character or account is decisive and beats everything. */
  decisive?: boolean;
}

/**
 * Combines matching grants: a decisive block wins, otherwise the highest granting role,
 * otherwise `blocked` if only blocks matched, otherwise null (no access).
 */
export function resolveMapRole(grants: readonly RoleGrant[]): MapRole | null {
  if (grants.some((g) => g.role === 'blocked' && g.decisive)) return 'blocked';
  let best: GrantingMapRole | null = null;
  for (const { role } of grants) {
    if (role !== 'blocked' && (best === null || mapRank[role] > mapRank[best])) best = role;
  }
  if (best) return best;
  return grants.length > 0 ? 'blocked' : null;
}

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

export function requireAccount(actor: Actor | null): AccountActor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.kind !== 'account') throw new ForbiddenError('Only a signed-in account can do that');
  return actor;
}

export function requireInstanceRole(actor: Actor | null, min: InstanceRole): AccountActor {
  const account = requireAccount(actor);
  if (!hasInstanceRole(account.instanceRole, min)) throw new ForbiddenError();
  return account;
}
