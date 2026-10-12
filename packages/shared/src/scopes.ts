import { z } from 'zod';

/**
 * API key scopes: what a credential (personal access token, service key, MCP client) may do, as
 * resource x action, on every map the principal reaches or on one map. Scopes only ever narrow
 * what the principal itself may do: the use cases still check the account's (or service key's)
 * own map roles, and the effective role on a map is the lower of the two.
 *
 * Grammar (see docs/api.md):
 *
 *   <resource>:<action>                 every map the principal can see (map resources) or the
 *                                       instance-wide resource (`account`, `universe`)
 *   map:<mapId>:<resource>:<action>     one map
 *   map:<mapId>:*                       everything on one map
 *   admin:read | admin:write | admin:*  instance administration (instance admins only)
 *   federation:*                        reserved for instance-to-instance sharing; refused today
 *
 * `*` stands for every resource or every action. Actions are ordered: `manage` includes `write`,
 * `write` includes `read`.
 */

/** Map-scoped resources. */
export const MAP_SCOPE_RESOURCES = [
  'maps',
  'systems',
  'connections',
  'signatures',
  'routes',
  'tracking',
  'audit',
  'webhooks',
  'access',
] as const;
export type MapScopeResource = (typeof MAP_SCOPE_RESOURCES)[number];

/** Resources that are not about one map. */
export const INSTANCE_SCOPE_RESOURCES = ['account', 'universe'] as const;
export type InstanceScopeResource = (typeof INSTANCE_SCOPE_RESOURCES)[number];

export type ScopeResource = MapScopeResource | InstanceScopeResource;
export const SCOPE_ACTIONS = ['read', 'write', 'manage'] as const;
export type ScopeAction = (typeof SCOPE_ACTIONS)[number];

const ACTION_RANK: Record<ScopeAction, number> = { read: 0, write: 1, manage: 2 };

export type MapRoleName = 'viewer' | 'member' | 'manager' | 'admin';
const ROLE_RANK: Record<MapRoleName, number> = { viewer: 0, member: 1, manager: 2, admin: 3 };

/**
 * The map role an action on a resource needs at least, i.e. the most a scope can let a credential
 * use of the principal's role on a map. `null`: the action does not exist for the resource.
 */
export const SCOPE_MAP_ROLE: Record<MapScopeResource, Record<ScopeAction, MapRoleName | null>> = {
  maps: { read: 'viewer', write: 'manager', manage: 'admin' },
  systems: { read: 'viewer', write: 'member', manage: 'manager' },
  connections: { read: 'viewer', write: 'member', manage: null },
  signatures: { read: 'viewer', write: 'member', manage: null },
  routes: { read: 'viewer', write: 'member', manage: null },
  tracking: { read: 'viewer', write: 'member', manage: null },
  audit: { read: 'viewer', write: 'member', manage: null },
  webhooks: { read: null, write: null, manage: 'admin' },
  access: { read: null, write: null, manage: 'admin' },
};

/** Human descriptions for the key pickers and the docs. */
export const SCOPE_RESOURCE_LABELS: Record<ScopeResource | 'admin', string> = {
  maps: 'Maps (read: list and open; write: labels, bookmark labels; manage: settings, sharing, delete)',
  systems: 'Systems on the map (write: add, move, edit, notes; manage: lock)',
  connections: 'Connections with mass and time status',
  signatures: 'Signatures (write: add, paste, edit, remove)',
  routes:
    "Routes, exits, hubs and jump bridges (write: map hubs; managers also the map's jump bridges and routing settings)",
  tracking: 'Tracked characters and their positions (write: track own characters)',
  audit: 'History of the map (write: revert a change)',
  webhooks: 'Webhooks of the map',
  access: 'Access rules of the map',
  account:
    'Own account (read: profile, landing, route options; write: main character, default map, hubs, route options, waypoints)',
  universe: 'Static game data (systems, wormhole types)',
  admin: 'Instance administration (instance admins only)',
};

export interface ParsedScope {
  /** Null: every map (or an instance resource). */
  mapId: string | null;
  /** `*` = every resource (on maps), `admin` and `federation` are special. */
  resource: ScopeResource | '*' | 'admin' | 'federation';
  action: ScopeAction | '*';
}

const MAP_ID = '[A-Za-z0-9-]{1,64}';
const RESOURCE = [...MAP_SCOPE_RESOURCES, ...INSTANCE_SCOPE_RESOURCES].join('|');
const ACTION = [...SCOPE_ACTIONS, '\\*'].join('|');
const SCOPE_RE = new RegExp(
  `^(?:(?:map:(${MAP_ID}):)?(${RESOURCE}|\\*):(${ACTION})|map:(${MAP_ID}):\\*|admin:(read|write|\\*)|federation:\\*)$`,
);

/** Parses one scope string; null when it is not in the grammar. */
export function parseScope(scope: string): ParsedScope | null {
  const m = SCOPE_RE.exec(scope);
  if (!m) return null;
  if (m[4]) return { mapId: m[4], resource: '*', action: '*' };
  if (m[5]) return { mapId: null, resource: 'admin', action: m[5] as ScopeAction | '*' };
  if (scope === 'federation:*') return { mapId: null, resource: 'federation', action: '*' };
  const resource = m[2] as ScopeResource | '*';
  // Instance resources have no map form.
  if (m[1] && (INSTANCE_SCOPE_RESOURCES as readonly string[]).includes(resource)) return null;
  return { mapId: m[1] ?? null, resource, action: m[3] as ScopeAction | '*' };
}

export const ApiScope = z
  .string()
  .max(140)
  .refine((s) => parseScope(s) !== null, { message: 'not a known scope (see docs/api.md)' });
export type ApiScope = z.infer<typeof ApiScope>;

/** Scopes kept for later features; a key cannot be created with them yet. */
export function isReservedScope(scope: string): boolean {
  return parseScope(scope)?.resource === 'federation';
}

/**
 * What one REST route or MCP tool needs from a credential.
 *
 * - `none`: nothing (public routes such as health; anyone may call them, with or without a key)
 * - `session`: signed-in browser sessions only; API keys are refused (sessions, key management,
 *   OAuth flows, credentials such as the Discord bot token)
 * - a resource and action, on the map in the path (`:mapId`) when there is one; `global` routes
 *   act on no existing map and need the all-maps form (creating a map)
 */
export type ScopeRequirement =
  | 'none'
  | 'session'
  | { resource: ScopeResource | '*'; action: ScopeAction; global?: true }
  | { resource: 'admin'; action: 'read' | 'write' };

export function describeRequirement(requirement: ScopeRequirement): string {
  if (requirement === 'none') return 'none';
  if (requirement === 'session') return 'session only (API keys are refused)';
  return `${requirement.resource}:${requirement.action}`;
}

function actionCovers(granted: ScopeAction | '*', needed: ScopeAction): boolean {
  return granted === '*' || ACTION_RANK[granted] >= ACTION_RANK[needed];
}

/**
 * Do the granted scopes cover the requirement on `mapId` (the map in the path, null when the
 * route has none)? Routes without a map (lists, searches) accept map-specific scopes too: the
 * principal's view of maps is narrowed to the maps the scopes name (see `scopeRoleCaps`).
 */
export function scopesAllow(
  granted: readonly string[],
  requirement: ScopeRequirement,
  mapId: string | null,
  readOnly = false,
): boolean {
  if (requirement === 'none') return true;
  if (requirement === 'session') return false;
  if (readOnly && requirement.action !== 'read') return false;
  for (const raw of granted) {
    const scope = parseScope(raw);
    if (!scope || scope.resource === 'federation') continue;
    if (requirement.resource === 'admin') {
      if (scope.resource === 'admin' && actionCovers(scope.action, requirement.action)) return true;
      continue;
    }
    if (scope.resource === 'admin') continue;
    // A scope on one map never reaches instance-wide resources (the account, game data).
    if (
      scope.mapId !== null &&
      (INSTANCE_SCOPE_RESOURCES as readonly string[]).includes(requirement.resource)
    )
      continue;
    if (requirement.resource === '*' && scope.resource !== '*') continue;
    if (scope.resource !== '*' && scope.resource !== requirement.resource) continue;
    if (!actionCovers(scope.action, requirement.action)) continue;
    if ('global' in requirement && requirement.global && scope.mapId !== null) continue;
    if (scope.mapId !== null && mapId !== null && scope.mapId !== mapId) continue;
    return true;
  }
  return false;
}

/** The highest map role an action on a resource (or on every resource) can need. */
function roleFor(resource: ScopeResource | '*', action: ScopeAction | '*'): MapRoleName | null {
  const resources = resource === '*' ? MAP_SCOPE_RESOURCES : [resource];
  let best: MapRoleName | null = null;
  for (const r of resources) {
    if (!(MAP_SCOPE_RESOURCES as readonly string[]).includes(r)) continue;
    const table = SCOPE_MAP_ROLE[r as MapScopeResource];
    const actions = action === '*' ? SCOPE_ACTIONS : SCOPE_ACTIONS.filter((a) => actionCovers(action, a));
    for (const a of actions) {
      const role = table[a];
      if (role && (best === null || ROLE_RANK[role] > ROLE_RANK[best])) best = role;
    }
  }
  return best;
}

export interface ScopeRoleCaps {
  /** Most the credential may use of the principal's role on any map; null: no map at all. */
  allMaps: MapRoleName | null;
  /** Per-map caps (raise the all-maps cap for that map). */
  maps: Record<string, MapRoleName>;
}

/**
 * The map role caps scopes imply: the principal's role on a map is lowered to what the scopes
 * could ever need there, and maps no scope names (or reaches through the all-maps form) become
 * invisible. A read-only credential is capped at viewer.
 */
export function scopeRoleCaps(granted: readonly string[], readOnly = false): ScopeRoleCaps {
  const caps: ScopeRoleCaps = { allMaps: null, maps: {} };
  const raise = (current: MapRoleName | null | undefined, role: MapRoleName | null) =>
    role === null ? (current ?? null) : current && ROLE_RANK[current] >= ROLE_RANK[role] ? current : role;
  for (const raw of granted) {
    const scope = parseScope(raw);
    if (!scope || scope.resource === 'admin' || scope.resource === 'federation') continue;
    if ((INSTANCE_SCOPE_RESOURCES as readonly string[]).includes(scope.resource)) continue;
    let role = roleFor(scope.resource as ScopeResource | '*', scope.action);
    if (role && readOnly) role = 'viewer';
    if (scope.mapId === null) caps.allMaps = raise(caps.allMaps, role);
    else {
      const next = raise(caps.maps[scope.mapId], role);
      if (next) caps.maps[scope.mapId] = next;
    }
  }
  for (const [mapId, role] of Object.entries(caps.maps)) {
    if (caps.allMaps && ROLE_RANK[caps.allMaps] >= ROLE_RANK[role]) delete caps.maps[mapId];
  }
  return caps;
}

/** Maps a list of scopes names explicitly. */
export function scopeMapIds(granted: readonly string[]): string[] {
  return [...new Set(granted.flatMap((s) => parseScope(s)?.mapId ?? []))];
}

/** True when some scope asks for instance administration. */
export function scopesNeedAdmin(granted: readonly string[]): boolean {
  return granted.some((s) => parseScope(s)?.resource === 'admin');
}

/** True when a scope asks for something other than reading. */
export function scopesWrite(granted: readonly string[]): boolean {
  return granted.some((s) => {
    const p = parseScope(s);
    return !!p && p.action !== 'read';
  });
}

/** Ready-made sets the UI offers. */
export const SCOPE_PRESETS: Record<string, { label: string; scopes: string[] }> = {
  readAll: { label: 'Read everything', scopes: ['*:read', 'account:read', 'universe:read'] },
  mapper: {
    label: 'Mapper (read, and write systems, connections and signatures)',
    scopes: [
      '*:read',
      'systems:write',
      'connections:write',
      'signatures:write',
      'account:read',
      'universe:read',
    ],
  },
};
