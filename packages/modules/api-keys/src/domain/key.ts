import type { Actor, CredentialGrant, GrantingMapRole, InstanceRole } from '@darkbeacon/core';
import {
  ipAllowed,
  parseScope,
  scopeRoleCaps,
  scopesNeedAdmin,
  type ApiKeyKind,
  type ApiKeyStatus,
  type ServiceKeyMapGrant,
} from '@darkbeacon/shared';

/** An API key as stored: everything but the secret itself (only its HMAC is kept). */
export interface ApiKey {
  id: string;
  kind: ApiKeyKind;
  name: string;
  /** The public part of the token, unique; finds the row. */
  lookup: string;
  secretHash: string;
  scopes: string[];
  readOnly: boolean;
  expiresAt: number | null;
  allowedIps: string[];
  rateLimitPerMinute: number | null;
  /** Personal tokens: the account they act as. */
  ownerAccountId: string | null;
  createdBy: string;
  /** Service keys only. */
  instanceRole: 'user' | 'admin' | null;
  mapGrants: ServiceKeyMapGrant[];
  allMapsRole: GrantingMapRole | null;
  createdAt: number;
  rotatedAt: number | null;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  revokedAt: number | null;
}

export function keyStatus(key: Pick<ApiKey, 'revokedAt' | 'expiresAt'>, now: number): ApiKeyStatus {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt !== null && key.expiresAt <= now) return 'expired';
  return 'active';
}

/** Why a key cannot be used right now, or null when it can. */
export function refusal(key: ApiKey, now: number, ip: string | null): string | null {
  const status = keyStatus(key, now);
  if (status === 'revoked') return 'This API key was revoked';
  if (status === 'expired') return 'This API key has expired';
  if (!ipAllowed(key.allowedIps, ip)) return 'This API key may not be used from this address';
  return null;
}

/** The grant a key gives its principal: its scopes as role caps per map. */
export function grantOf(key: ApiKey, channel: CredentialGrant['channel']): CredentialGrant {
  const caps = scopeRoleCaps(key.scopes, key.readOnly);
  return {
    credentialId: key.id,
    name: key.name,
    kind: key.kind,
    channel,
    scopes: key.scopes,
    readOnly: key.readOnly,
    allMaps: caps.allMaps,
    maps: caps.maps,
  };
}

/**
 * The instance role a personal token may use: never `owner` (ownership is transferred in the web
 * app), `admin` only when the account is an admin and the key holds an `admin:` scope.
 */
export function tokenInstanceRole(ownerRole: InstanceRole, scopes: readonly string[]): 'user' | 'admin' {
  return ownerRole !== 'user' && scopesNeedAdmin(scopes) ? 'admin' : 'user';
}

/** The actor a personal token acts as: its owner, narrowed by the key. */
export function personalActor(
  key: ApiKey,
  owner: { id: string; instanceRole: InstanceRole },
  channel: CredentialGrant['channel'],
): Actor {
  return {
    kind: 'account',
    id: owner.id,
    instanceRole: tokenInstanceRole(owner.instanceRole, key.scopes),
    grant: grantOf(key, channel),
  };
}

/** The actor of a service key: its own principal with the roles an admin gave it, narrowed by its scopes. */
export function serviceActor(key: ApiKey, channel: CredentialGrant['channel']): Actor {
  return {
    kind: 'apiToken',
    id: key.id,
    instanceRole: key.instanceRole === 'admin' && scopesNeedAdmin(key.scopes) ? 'admin' : 'user',
    roles: {
      allMaps: key.allMapsRole,
      maps: Object.fromEntries(key.mapGrants.map((g) => [g.mapId, g.role])),
    },
    grant: grantOf(key, channel),
  };
}

/** Maps a list of scopes or grants refers to. */
export function referencedMaps(key: Pick<ApiKey, 'scopes' | 'mapGrants'>): string[] {
  const ids = new Set<string>();
  for (const scope of key.scopes) {
    const mapId = parseScope(scope)?.mapId;
    if (mapId) ids.add(mapId);
  }
  for (const grant of key.mapGrants) ids.add(grant.mapId);
  return [...ids];
}
