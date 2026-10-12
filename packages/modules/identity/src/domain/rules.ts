import type { InstanceRole } from '@darkbeacon/core';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions slide and `lastSeenAt` updates at most this often, so most requests do not write. */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
/** Guild roles older than this are re-read from Discord in the background. */
export const GUILD_ROLES_TTL_MS = 5 * 60 * 1000;
/** How long an OAuth round trip may take. */
export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
/** Refresh EVE access tokens this long before they expire. */
export const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/** Lets the app set the in-game destination and waypoints of a character. */
export const WAYPOINT_SCOPE = 'esi-ui.write_waypoint.v1';

/**
 * The scope of ESI's character search (`GET /characters/{character_id}/search`), which the
 * name pickers use; its name says structures, but it covers every search category.
 */
export const EVE_SEARCH_SCOPE = 'esi-search.search_structures.v1';

/**
 * Contacts of the character, its corporation and its alliance (`GET /characters/{id}/contacts`,
 * `/corporations/{id}/contacts`, `/alliances/{id}/contacts`): the standings that colour who holds
 * a system.
 */
export const EVE_CONTACT_SCOPES = [
  'esi-characters.read_contacts.v1',
  'esi-corporations.read_contacts.v1',
  'esi-alliances.read_contacts.v1',
] as const;

/**
 * Lets the app read the structures of the character's corporation (its Ansiblex jump bridges);
 * ESI also wants the in-game Station_Manager role for it.
 */
export const CORPORATION_STRUCTURES_SCOPE = 'esi-corporations.read_structures.v1';

/**
 * ESI scopes requested when linking a character: location, ship and online status for tracking,
 * the autopilot waypoints for routes, search for the name pickers, contacts for standings and
 * corporation structures for jump bridges. Characters linked before a scope was added lack it
 * until they are linked again.
 */
export const EVE_SCOPES: readonly string[] = [
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  WAYPOINT_SCOPE,
  EVE_SEARCH_SCOPE,
  ...EVE_CONTACT_SCOPES,
  CORPORATION_STRUCTURES_SCOPE,
];

/**
 * Scopes a character only grants when its owner opts in (linking again with `extras`): the
 * assets to weigh the ship actually flown, and the wallet balance on the characters page.
 */
export const OPTIONAL_EVE_SCOPES = {
  assets: 'esi-assets.read_assets.v1',
  wallet: 'esi-wallet.read_character_wallet.v1',
} as const;
export type OptionalEveScope = keyof typeof OPTIONAL_EVE_SCOPES;

/** The extras named in a `?extras=assets,wallet` value; unknown names are ignored. */
export function parseExtras(value: unknown): OptionalEveScope[] {
  if (typeof value !== 'string') return [];
  const names = value.split(',').map((v) => v.trim());
  return (Object.keys(OPTIONAL_EVE_SCOPES) as OptionalEveScope[]).filter((k) => names.includes(k));
}

/** What EVE SSO is asked for when linking: every required scope plus the chosen extras. */
export function linkScopes(extras: readonly OptionalEveScope[] = []): string[] {
  return [...EVE_SCOPES, ...extras.map((e) => OPTIONAL_EVE_SCOPES[e])];
}

/** Required scopes a grant lacks (characters linked before a scope was added). */
export function missingScopes(granted: readonly string[]): string[] {
  return EVE_SCOPES.filter((s) => !granted.includes(s));
}

/** The opt-in extras a grant holds. */
export function grantedExtras(granted: readonly string[]): OptionalEveScope[] {
  return (Object.keys(OPTIONAL_EVE_SCOPES) as OptionalEveScope[]).filter((k) =>
    granted.includes(OPTIONAL_EVE_SCOPES[k]),
  );
}

/**
 * EVE refuses a refresh now and then without the grant being gone; like Wanderer, a token is
 * given up only after this many refusals within the window.
 */
export const TOKEN_STRIKES = { max: 3, windowMs: 2 * 60 * 60 * 1000 } as const;

export interface TokenStrikes {
  count: number;
  firstAt: number;
}

/** Counts one more refusal; a refusal after the window starts a new count. */
export function addStrike(previous: TokenStrikes | undefined, now: number): TokenStrikes {
  if (!previous || now - previous.firstAt > TOKEN_STRIKES.windowMs) return { count: 1, firstAt: now };
  return { count: previous.count + 1, firstAt: previous.firstAt };
}

/** How many recently opened maps an account remembers. */
export const RECENT_MAPS = 5;

/** `mapId` first, then the others, without duplicates, at most RECENT_MAPS. */
export function withRecentMap(recent: readonly string[] | undefined, mapId: string): string[] {
  return [mapId, ...(recent ?? []).filter((id) => id !== mapId)].slice(0, RECENT_MAPS);
}

export type LandingReason = 'account' | 'instance' | 'recent' | 'only' | 'first';

/**
 * The map `/` opens: the account's own default, else the instance default, else the map opened
 * last, else the only map. With several maps and none of those, the first one (by name), so `/`
 * always lands on a map; null only when the account can see no map at all. Ids that point at
 * maps the account cannot see (deleted, access lost) are skipped.
 */
export function chooseLanding<M extends { id: string }>(input: {
  maps: readonly M[];
  accountDefault: string | null | undefined;
  instanceDefault: string | null | undefined;
  recent: readonly string[] | undefined;
}): { map: M; reason: LandingReason } | null {
  const find = (id: string | null | undefined) => (id ? input.maps.find((m) => m.id === id) : undefined);
  const account = find(input.accountDefault);
  if (account) return { map: account, reason: 'account' };
  const instance = find(input.instanceDefault);
  if (instance) return { map: instance, reason: 'instance' };
  for (const id of input.recent ?? []) {
    const recent = find(id);
    if (recent) return { map: recent, reason: 'recent' };
  }
  if (input.maps.length === 1) return { map: input.maps[0]!, reason: 'only' };
  return input.maps[0] ? { map: input.maps[0], reason: 'first' } : null;
}

export interface DeviceDescription {
  browser: string | null;
  os: string | null;
  device: 'desktop' | 'mobile' | 'tablet' | 'unknown';
}

/** A readable name for a session's browser and device, from its User-Agent header. */
export function describeUserAgent(userAgent: string | null): DeviceDescription {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Vivaldi\//.test(ua)
        ? 'Vivaldi'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? 'Safari'
              : /EVE|CCP/.test(ua)
                ? 'EVE launcher'
                : null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  const device =
    /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? 'tablet'
      : /Mobile|iPhone/.test(ua)
        ? 'mobile'
        : browser || os
          ? 'desktop'
          : 'unknown';
  return { browser, os, device };
}

/** The first account of an instance becomes its owner. */
export function initialInstanceRole(existingAccounts: number): InstanceRole {
  return existingAccounts === 0 ? 'owner' : 'user';
}

/** Stored role, raised to admin when a Discord guild role grants it. Never lowers a role. */
export function effectiveInstanceRole(stored: InstanceRole, adminByDiscord: boolean): InstanceRole {
  return stored === 'user' && adminByDiscord ? 'admin' : stored;
}

const RETURN_BASE = 'http://return.invalid';

/**
 * Only same-origin absolute paths are allowed as post-login destinations. Browsers drop tabs and
 * newlines from URLs and read `\` as `/`, so any of those (or other control characters) is refused,
 * and the result is the path as a URL parser sees it.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return '/';
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || /[\x00-\x20\x7f\\]/.test(value)) return '/';
  try {
    const url = new URL(value, RETURN_BASE);
    if (url.origin !== RETURN_BASE) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

/** A stable fake EVE id for dev-login characters, above the ids real characters use today. */
export function devCharacterId(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 3_900_000_000 + (hash % 90_000_000);
}
