import { parseScope, scopesNeedAdmin } from '@darkbeacon/shared';

/** A client: identified by its Client ID Metadata Document URL, or registered dynamically. */
export interface OAuthClient {
  id: string;
  kind: 'metadata' | 'registered';
  name: string;
  uri: string | null;
  redirectUris: string[];
  createdAt: number;
  /** When the metadata document was read (metadata clients). */
  fetchedAt: number;
}

/** A person's approval of a client; tokens hang off it and die with it. */
export interface OAuthGrant {
  id: string;
  accountId: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  scopes: string[];
  readOnly: boolean;
  resource: string;
  createdAt: number;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  revokedAt: number | null;
}

/** A single-use authorization code, bound to the client, the redirect URI and the PKCE challenge. */
export interface AuthorizationCode {
  lookup: string;
  secretHash: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: number;
  usedAt: number | null;
}

export type TokenKind = 'access' | 'refresh';

export interface OAuthToken {
  lookup: string;
  secretHash: string;
  kind: TokenKind;
  grantId: string;
  expiresAt: number;
  createdAt: number;
  /** Refresh tokens rotate: a used one is kept to notice reuse (which revokes the grant). */
  usedAt: number | null;
}

export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
/** Metadata documents are read again after this long. */
export const CLIENT_METADATA_TTL_MS = 60 * 60_000;
/** What a client gets when it asks for nothing: read access everywhere the person reaches. */
export const DEFAULT_OAUTH_SCOPES = ['*:read', 'account:read', 'universe:read'];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A redirect URI a client may register: https, or http on a loopback address (native apps,
 * RFC 8252), or a private-use scheme of a native app (`com.example.app:/callback`); never with a
 * fragment or user info.
 */
export function validRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  // Private-use schemes look like reversed domain names (`com.example.app:`).
  return (
    /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(url.protocol) &&
    !['javascript:', 'data:', 'file:'].includes(url.protocol)
  );
}

/**
 * Exact match against the registered URIs; for loopback http any port matches (RFC 8252 7.3: the
 * native app picks a free port when it starts).
 */
export function redirectAllowed(registered: readonly string[], uri: string): boolean {
  if (!validRedirectUri(uri)) return false;
  if (registered.includes(uri)) return true;
  const asked = new URL(uri);
  if (asked.protocol !== 'http:' || !LOOPBACK.has(asked.hostname)) return false;
  return registered.some((r) => {
    const url = new URL(r);
    return (
      url.protocol === 'http:' &&
      url.hostname === asked.hostname &&
      url.pathname === asked.pathname &&
      url.search === asked.search
    );
  });
}

/** Space-separated scopes, deduplicated, in the order given; unknown or reserved ones refused. */
export function parseScopeParam(scope: string | undefined): { scopes: string[]; invalid: string[] } {
  const items = [...new Set((scope ?? '').split(/\s+/).filter(Boolean))];
  // `offline_access` asks for a refresh token, which this server always issues.
  const known = items.filter((s) => s !== 'offline_access');
  const invalid = known.filter((s) => !parseScope(s) || parseScope(s)!.resource === 'federation');
  return { scopes: known.filter((s) => !invalid.includes(s)), invalid };
}

/**
 * Narrows map scopes to the maps a person picked: `systems:write` becomes
 * `map:<id>:systems:write` for each picked map; instance resources (`account`, `universe`) and
 * scopes already on one of the picked maps stay, scopes on other maps go.
 */
export function narrowToMaps(scopes: readonly string[], mapIds: readonly string[] | null): string[] {
  if (mapIds === null) return [...scopes];
  const out = new Set<string>();
  for (const raw of scopes) {
    const scope = parseScope(raw);
    if (!scope) continue;
    if (scope.resource === 'admin' || scope.resource === 'account' || scope.resource === 'universe') {
      out.add(raw);
      continue;
    }
    if (scope.mapId !== null) {
      if (mapIds.includes(scope.mapId)) out.add(raw);
      continue;
    }
    for (const mapId of mapIds) out.add(`map:${mapId}:${scope.resource}:${scope.action}`);
  }
  return [...out];
}

/** Admin scopes are never granted through OAuth: administration stays in the web app. */
export function withoutAdmin(scopes: readonly string[]): string[] {
  return scopesNeedAdmin(scopes) ? scopes.filter((s) => parseScope(s)?.resource !== 'admin') : [...scopes];
}

/**
 * The canonical resource of the MCP endpoint (RFC 8707). Clients may name the endpoint or the
 * instance's origin; either way the token is only good for `/mcp`.
 */
export function resourceMatches(asked: string | undefined, publicUrl: string): boolean {
  if (asked === undefined) return true;
  const normalize = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return null;
    }
  };
  const target = normalize(asked);
  return target !== null && (target === normalize(`${publicUrl}/mcp`) || target === normalize(publicUrl));
}
