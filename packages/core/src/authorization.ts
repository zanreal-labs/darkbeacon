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

/**
 * What a credential (an API key, an MCP client) lets its principal use. It only ever narrows:
 * the principal's own role on a map is lowered to the cap, maps without a cap are invisible.
 * Computed when the credential is resolved; see `scopeRoleCaps` in `@darkbeacon/shared`.
 */
export interface CredentialGrant {
  credentialId: string;
  /** The key's name, for the audit trail ("via key <name>"). */
  name: string;
  /** `pat` personal access token, `svc` service key, `oauth` an OAuth client a person approved. */
  kind: 'pat' | 'svc' | 'oauth';
  /** How the request came in: the REST API or the MCP endpoint. */
  channel: 'api' | 'mcp';
  /** The scopes as granted, for checks at the edge (routes, MCP tools). */
  scopes: readonly string[];
  readOnly: boolean;
  /** Most of the principal's role it may use on any map (null: none). */
  allMaps: GrantingMapRole | null;
  /** Per-map caps, above `allMaps` for these maps. */
  maps: Readonly<Record<string, GrantingMapRole>>;
}

/** The authenticated caller of a use case. */
export type Actor =
  | {
      kind: 'account';
      id: string;
      instanceRole: InstanceRole;
      /** Set when the account acts through a personal access token. */
      grant?: CredentialGrant;
    }
  | {
      /** A service key: its own principal with explicit roles, made by an instance admin. */
      kind: 'apiToken';
      id: string;
      instanceRole: Exclude<InstanceRole, 'owner'>;
      /** Its own map roles (the principal's rights). */
      roles: { allMaps: GrantingMapRole | null; maps: Readonly<Record<string, GrantingMapRole>> };
      grant: CredentialGrant;
    }
  | {
      /** An anonymous visitor of a public map: a viewer of that map only, through its link. */
      kind: 'public';
      /** The share it came through. */
      id: string;
      mapId: string;
    }
  | { kind: 'system'; id: string }
  | { kind: 'plugin'; id: string };

export type AccountActor = Extract<Actor, { kind: 'account' }>;
export type ServiceActor = Extract<Actor, { kind: 'apiToken' }>;
/** An actor with an instance role: an account, or a service key. */
export type PrincipalActor = AccountActor | ServiceActor;

export function actorRef(actor: Actor): ActorRef {
  return { kind: actor.kind, id: actor.id };
}

/** The credential an actor came through, if any. */
export function grantOf(actor: Actor | null): CredentialGrant | null {
  if (actor?.kind === 'account') return actor.grant ?? null;
  if (actor?.kind === 'apiToken') return actor.grant;
  return null;
}

/**
 * Lowers `role` (the principal's own role on `mapId`) to what the actor's credential allows
 * there. Without a credential the role is unchanged; a credential that does not reach the map
 * leaves no role at all, so the map stays invisible to it.
 */
export function capMapRole(actor: Actor, mapId: string, role: MapRole | null): MapRole | null {
  const grant = grantOf(actor);
  if (!grant || role === null || role === 'blocked') return role;
  const cap = grant.maps[mapId] ?? grant.allMaps;
  if (cap === null || cap === undefined) return null;
  return mapRank[cap] < mapRank[role] ? cap : role;
}

export function hasInstanceRole(role: InstanceRole, min: InstanceRole): boolean {
  return instanceRank[role] >= instanceRank[min];
}

export function isInstanceAdmin(actor: Actor | null): boolean {
  return (
    (actor?.kind === 'account' || actor?.kind === 'apiToken') && hasInstanceRole(actor.instanceRole, 'admin')
  );
}

/** True when `role` grants at least `min`. `blocked` and `null` grant nothing. */
export function hasMapRole(role: MapRole | null, min: GrantingMapRole): boolean {
  return role !== null && role !== 'blocked' && mapRank[role] >= mapRank[min];
}

export interface RoleGrant {
  role: MapRole;
  /**
   * True when the rule names one person (a character or an account); false or absent when it
   * names a group (a corporation, an alliance or a Discord role).
   */
  personal?: boolean;
}

/**
 * Combines matching grants the way Wanderer does (`check_characters_access`):
 * 1. A block on one of the person's characters, or on the account, beats everything.
 * 2. A block on a group (corporation, alliance, Discord role) beats every group grant; past it
 *    only personal grants count, and with none the person stays blocked.
 * 3. Otherwise the highest granted role wins.
 *
 * `null` means nothing matched (no access); `blocked` means something matched and refused.
 */
export function resolveMapRole(grants: readonly RoleGrant[]): MapRole | null {
  if (grants.length === 0) return null;
  if (grants.some((g) => g.role === 'blocked' && g.personal)) return 'blocked';
  const groupBlocked = grants.some((g) => g.role === 'blocked');
  let best: GrantingMapRole | null = null;
  for (const { role, personal } of grants) {
    if (role === 'blocked' || (groupBlocked && !personal)) continue;
    if (best === null || mapRank[role] > mapRank[best]) best = role;
  }
  return best ?? 'blocked';
}

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/** An account or a service key: someone with an instance role (not a public visitor). */
export function requirePrincipal(actor: Actor | null): PrincipalActor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.kind !== 'account' && actor.kind !== 'apiToken') throw new ForbiddenError();
  return actor;
}

export function requireAccount(actor: Actor | null): AccountActor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.kind !== 'account') throw new ForbiddenError('Only a signed-in account can do that');
  return actor;
}

/**
 * Throws unless the actor holds `min` on the instance: an account, or (up to `admin`) a service
 * key an instance admin gave that role.
 */
export function requireInstanceRole(actor: Actor | null, min: InstanceRole): PrincipalActor {
  if (!actor) throw new UnauthenticatedError();
  if (actor.kind === 'apiToken') {
    if (!hasInstanceRole(actor.instanceRole, min)) throw new ForbiddenError();
    return actor;
  }
  const account = requireAccount(actor);
  if (!hasInstanceRole(account.instanceRole, min)) throw new ForbiddenError();
  return account;
}
