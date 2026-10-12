import type { ChainDelta, ChainEntry, ChainObjectKind, ShareScope } from '@darkbeacon/shared';

/**
 * Who may see a field outside its map. `local` fields never leave their map (Tags and locks
 * point at things only that map has); they reach a map's own merged view only.
 */
export type FieldScope = ShareScope | 'local';

/**
 * The wire fields of every kind and the scope each belongs to. A field not listed here is not
 * part of the format and never leaves its map.
 */
export const FIELD_SCOPES: Record<ChainObjectKind, Record<string, FieldScope>> = {
  system: {
    /** Where the source placed it: only a hint for a first position, every map lays itself out. */
    pos: 'topology',
    status: 'intel',
    tag: 'intel',
    customName: 'intel',
    notes: 'intel',
    /** The bookmark label (temporary name). */
    label: 'labels',
    /** Names of the system's Labels (WH1, WH2...): each map matches them to its own by name. */
    systemLabels: 'labels',
    /** The system's free-text custom label. */
    customLabel: 'labels',
    /** The system's Tags: ids of the map's own list. */
    labelIds: 'local',
    locked: 'local',
  },
  connection: {
    /** `wormhole`, `gate` or `bridge`. */
    kind: 'topology',
    /** The wormhole type when a signature names it (never K162): tells two holes on one pair apart. */
    whType: 'topology',
    /** `{ status, eolAt }`. */
    time: 'connectionStatus',
    /** `{ status, at }`. */
    mass: 'connectionStatus',
    size: 'connectionStatus',
    massSaved: 'connectionStatus',
    dangerous: 'connectionStatus',
    /** `none`, `low`, `high` or `both`: the bubbled end by system id, not by direction. */
    bubbled: 'connectionStatus',
  },
  signature: {
    group: 'signatures',
    type: 'signatures',
    name: 'signatures',
    notes: 'signatures',
    /** The pair key of the connection it leads through, or null. */
    link: 'signatures',
  },
  character: {
    name: 'characters',
    location: 'characters',
    /** `{ typeId, name }`. */
    ship: 'characters',
    online: 'characters',
    /** The owning account: meaningful on its own instance and map only. */
    account: 'local',
  },
};

/** The scope an object needs to be shared at all. */
export const OBJECT_SCOPES: Record<ChainObjectKind, ShareScope> = {
  system: 'topology',
  connection: 'topology',
  signature: 'signatures',
  character: 'characters',
};

const ORDER: readonly ShareScope[] = [
  'topology',
  'connectionStatus',
  'signatures',
  'intel',
  'characters',
  'labels',
];

/** Sorted, without duplicates, topology always in. */
export function normalizeScopes(scopes: readonly ShareScope[]): ShareScope[] {
  const set = new Set<ShareScope>(scopes);
  set.add('topology');
  return ORDER.filter((s) => set.has(s));
}

/** What the target receives: the source's offer, narrowed by the target (never widened). */
export function effectiveScopes(
  offered: readonly ShareScope[],
  narrowed: readonly ShareScope[] | null,
): ShareScope[] {
  const offer = new Set(normalizeScopes(offered));
  return normalizeScopes((narrowed ?? [...offer]).filter((s) => offer.has(s)));
}

/** True when `scopes` (or a map's own view, `'all'`) lets `field` of `kind` through. */
export function fieldAllowed(
  kind: ChainObjectKind,
  field: string,
  scopes: readonly ShareScope[] | 'all',
): boolean {
  const scope = FIELD_SCOPES[kind][field];
  if (!scope) return false;
  if (scopes === 'all') return true;
  return scope !== 'local' && scopes.includes(scope);
}

/** True when objects of `kind` are shared under `scopes`. */
export function objectAllowed(kind: ChainObjectKind, scopes: readonly ShareScope[] | 'all'): boolean {
  return scopes === 'all' || scopes.includes(OBJECT_SCOPES[kind]);
}

/**
 * Cuts one entry to what `scopes` let through: null when the object is not shared at all, else
 * the entry with only the allowed fields. Sources run this before anything leaves them.
 */
export function projectEntry(entry: ChainEntry, scopes: readonly ShareScope[] | 'all'): ChainEntry | null {
  if (!objectAllowed(entry.kind, scopes)) return null;
  if (entry.state !== 'present') return entry;
  const fields: typeof entry.fields = {};
  for (const [name, value] of Object.entries(entry.fields)) {
    if (fieldAllowed(entry.kind, name, scopes)) fields[name] = value;
  }
  return { ...entry, fields };
}

export function projectDelta(delta: ChainDelta, scopes: readonly ShareScope[] | 'all'): ChainDelta {
  const entries: ChainEntry[] = [];
  for (const entry of delta.entries) {
    const cut = projectEntry(entry, scopes);
    if (cut) entries.push(cut);
  }
  return { ...delta, scopes: scopes === 'all' ? delta.scopes : normalizeScopes(scopes), entries };
}
