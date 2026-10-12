import {
  INSTANCE_SCOPE_RESOURCES,
  isCidr,
  MAP_SCOPE_RESOURCES,
  parseScope,
  SCOPE_ACTIONS,
  SCOPE_MAP_ROLE,
  SCOPE_PRESETS,
  type ApiKeyDto,
  type ScopeAction,
  type ScopeResource,
} from '@darkbeacon/shared';

/**
 * What the API key forms build: scope strings from a preset or per-resource choices, on every map
 * or on maps picked by name, and the same scopes read back as sentences. Pure, so it is tested
 * without a browser. Map ids only ever travel inside scope strings; people see names.
 */

export type PresetId = 'readAll' | 'mapper' | 'custom';
export type BuilderResource = ScopeResource | 'admin';
/** Custom access: the action per resource; absent means none. */
export type Access = Partial<Record<BuilderResource, ScopeAction>>;

export interface ScopeDraft {
  preset: PresetId;
  access: Access;
  /** Map resources reach every map the key can see, or only the picked ones. */
  maps: 'all' | 'picked';
  mapIds: string[];
}

/** The server takes at most this many scopes per key. */
export const MAX_SCOPES = 64;

/** The order resources are offered (and scopes written) in. */
export const BUILDER_RESOURCES: readonly BuilderResource[] = [
  ...MAP_SCOPE_RESOURCES,
  ...INSTANCE_SCOPE_RESOURCES,
  'admin',
];

const INSTANCE = new Set<string>(INSTANCE_SCOPE_RESOURCES);

export const isMapResource = (r: BuilderResource): boolean => r !== 'admin' && !INSTANCE.has(r);

/** Actions a resource offers, lowest first (what `SCOPE_MAP_ROLE` allows for map resources). */
export function actionsFor(resource: BuilderResource): ScopeAction[] {
  if (resource === 'admin' || resource === 'account') return ['read', 'write'];
  if (resource === 'universe') return ['read'];
  return SCOPE_ACTIONS.filter((a) => SCOPE_MAP_ROLE[resource][a] !== null);
}

export const emptyDraft = (): ScopeDraft => ({ preset: 'readAll', access: {}, maps: 'all', mapIds: [] });

/** The scope strings a draft stands for, in a stable order, without repeats. */
export function draftScopes(draft: ScopeDraft): string[] {
  const base =
    draft.preset === 'custom'
      ? BUILDER_RESOURCES.flatMap((r) => {
          const action = draft.access[r];
          return action && actionsFor(r).includes(action) ? [`${r}:${action}`] : [];
        })
      : SCOPE_PRESETS[draft.preset]!.scopes;
  if (draft.maps === 'all') return [...new Set(base)];
  const perMap: string[] = [];
  const rest: string[] = [];
  for (const scope of base) {
    const parsed = parseScope(scope);
    if (!parsed) continue;
    const onMaps =
      parsed.mapId === null &&
      parsed.resource !== 'admin' &&
      parsed.resource !== 'federation' &&
      !INSTANCE.has(parsed.resource);
    if (onMaps) perMap.push(`${parsed.resource}:${parsed.action}`);
    else rest.push(scope);
  }
  const scoped = draft.mapIds.flatMap((id) => perMap.map((s) => `map:${id}:${s}`));
  return [...new Set([...scoped, ...rest])];
}

/** Why the draft cannot be saved yet, in words; null when it can. */
export function draftProblem(draft: ScopeDraft): string | null {
  const scopes = draftScopes(draft);
  const needsMaps =
    draft.maps === 'picked' &&
    (draft.preset !== 'custom' || BUILDER_RESOURCES.some((r) => isMapResource(r) && draft.access[r]));
  if (needsMaps && draft.mapIds.length === 0) return 'Pick at least one map.';
  if (scopes.length === 0) return 'Give the key at least one permission.';
  if (scopes.length > MAX_SCOPES)
    return `That is ${scopes.length} permissions, more than the ${MAX_SCOPES} a key can hold. Pick fewer maps, or make a second key.`;
  return null;
}

// ---- Reading scopes back ------------------------------------------------------------------------

const VERB: Record<ScopeAction | '*', string> = {
  read: 'read',
  write: 'change',
  manage: 'manage',
  '*': 'fully use',
};

const NOUN: Record<ScopeResource | '*', string> = {
  '*': 'everything',
  maps: 'maps',
  systems: 'systems',
  connections: 'connections',
  signatures: 'signatures',
  routes: 'routes',
  tracking: 'tracking',
  audit: 'history',
  webhooks: 'webhooks',
  access: 'access rules',
  account: 'the account',
  universe: 'game data',
};

const ACTION_ORDER: readonly (ScopeAction | '*')[] = ['read', 'write', 'manage', '*'];

/** "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "read everything, change systems and signatures" for a set of resource -> action. */
function phrase(grants: Map<ScopeResource | '*', ScopeAction | '*'>): string {
  if (grants.get('*') === '*') return 'everything';
  const parts: string[] = [];
  for (const action of ACTION_ORDER) {
    const nouns = [...grants].filter(([, a]) => a === action).map(([r]) => NOUN[r]);
    if (nouns.length > 0) parts.push(`${VERB[action]} ${listWords(nouns)}`);
  }
  return parts.join(', ');
}

export interface DescribeOptions {
  /** How "every map" reads for this kind of key. */
  everyMap?: string;
}

/**
 * The scopes of a key as short sentences, maps by name ("Read everything on Home chain and
 * Staging"). A map the key names but the server could not name reads "a map you cannot see".
 */
export function describeScopes(
  scopes: readonly string[],
  maps: readonly { id: string; name: string }[],
  { everyMap = 'all your maps' }: DescribeOptions = {},
): string[] {
  const byMap = new Map<string | null, Map<ScopeResource | '*', ScopeAction | '*'>>();
  const instance = new Map<ScopeResource | '*', ScopeAction | '*'>();
  let admin: ScopeAction | '*' | null = null;
  for (const raw of scopes) {
    const scope = parseScope(raw);
    if (!scope || scope.resource === 'federation') continue;
    if (scope.resource === 'admin') {
      admin =
        admin === '*' || scope.action === '*' ? '*' : scope.action === 'write' ? 'write' : (admin ?? 'read');
      continue;
    }
    const target = INSTANCE.has(scope.resource)
      ? instance
      : (byMap.get(scope.mapId) ?? byMap.set(scope.mapId, new Map()).get(scope.mapId)!);
    target.set(scope.resource, scope.action);
  }
  const lines: string[] = [];
  const all = byMap.get(null);
  if (all) lines.push(capitalize(`${phrase(all)} on ${everyMap}`));
  // Maps with the same permissions read as one sentence.
  const groups = new Map<string, { text: string; names: string[] }>();
  for (const [mapId, grants] of byMap) {
    if (mapId === null) continue;
    const text = phrase(grants);
    const name = maps.find((m) => m.id === mapId)?.name ?? 'a map you cannot see';
    const group = groups.get(text) ?? groups.set(text, { text, names: [] }).get(text)!;
    group.names.push(name);
  }
  for (const { text, names } of groups.values()) lines.push(capitalize(`${text} on ${listWords(names)}`));
  if (instance.size > 0) lines.push(capitalize(phrase(instance)));
  if (admin) lines.push(admin === 'read' ? 'Read instance administration' : 'Instance administration');
  return lines;
}

const ROLE_WORD: Record<'viewer' | 'member' | 'manager' | 'admin', string> = {
  viewer: 'Viewer',
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
};

/** What a service key is: its instance role and its roles on maps, by map name. */
export function describeGrants(
  key: Pick<ApiKeyDto, 'instanceRole' | 'allMapsRole' | 'mapGrants' | 'maps'>,
): string[] {
  const lines: string[] = [];
  if (key.instanceRole === 'admin') lines.push('Instance admin');
  if (key.allMapsRole) lines.push(`${ROLE_WORD[key.allMapsRole]} on every map`);
  const byRole = new Map<string, string[]>();
  for (const grant of key.mapGrants) {
    const name = key.maps.find((m) => m.id === grant.mapId)?.name ?? 'a map you cannot see';
    byRole.set(grant.role, [...(byRole.get(grant.role) ?? []), name]);
  }
  for (const [role, names] of byRole)
    lines.push(`${ROLE_WORD[role as keyof typeof ROLE_WORD]} on ${listWords(names)}`);
  return lines;
}

// ---- Expiry, IP allow-lists ---------------------------------------------------------------------

export type ExpiryChoice = 'never' | '7' | '30' | '90' | 'date';

const DAY = 24 * 60 * 60_000;

/** Epoch ms for an expiry choice; a picked date (`YYYY-MM-DD`) lasts to the end of that day. */
export function expiresAtFor(choice: ExpiryChoice, date: string, now = Date.now()): number | null {
  if (choice === 'never') return null;
  if (choice !== 'date') return now + Number(choice) * DAY;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const end = new Date(`${date}T23:59:59`).getTime();
  return Number.isFinite(end) ? end : null;
}

/** IP addresses and CIDR ranges from free text (lines, commas or spaces between them). */
export function parseIpList(text: string): { ips: string[]; invalid: string[] } {
  const items = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  return { ips: items.filter((i) => isCidr(i)), invalid: items.filter((i) => !isCidr(i)) };
}

/** "in 5 min", "in 3 h", "in 12 d", then a date. */
export function untilWords(ms: number, now = Date.now()): string {
  const minutes = Math.round((ms - now) / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `in ${days} d`;
  return `on ${new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
