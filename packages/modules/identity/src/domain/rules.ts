import type { InstanceRole } from '@wormwright/core';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions slide and `lastSeenAt` updates at most this often, so most requests do not write. */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
/** Guild roles older than this are re-read from Discord in the background. */
export const GUILD_ROLES_TTL_MS = 5 * 60 * 1000;
/** How long an OAuth round trip may take. */
export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
/** Refresh EVE access tokens this long before they expire. */
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/** ESI scopes requested when linking a character: location, ship and online status for tracking. */
export const EVE_SCOPES: readonly string[] = [
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
];

/** The first account of an instance becomes its owner. */
export function initialInstanceRole(existingAccounts: number): InstanceRole {
  return existingAccounts === 0 ? 'owner' : 'user';
}

/** Stored role, raised to admin when a Discord guild role grants it. Never lowers a role. */
export function effectiveInstanceRole(stored: InstanceRole, adminByDiscord: boolean): InstanceRole {
  return stored === 'user' && adminByDiscord ? 'admin' : stored;
}

/** Only same-origin absolute paths are allowed as post-login destinations. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}

/** A stable fake EVE id for dev-login characters, above the ids real characters use today. */
export function devCharacterId(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 3_900_000_000 + (hash % 90_000_000);
}
