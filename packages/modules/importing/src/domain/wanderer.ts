import type { ImportSourceDto } from '@darkbeacon/shared';

/**
 * What a Wanderer map holds, read from its API or its export file and normalised. Field names
 * and value codes are the ones a running Wanderer answers with (recorded in
 * tools/fake-wanderer/recorded); the readers below accept the variants that the API routes and
 * the export formats use (numbers as strings, `position` or `position_x/y`, labels as JSON or as
 * a comma list, JSON:API resources flattened to their attributes).
 */
export interface WandererMapDump {
  source: ImportSourceDto;
  map: {
    name: string | null;
    slug: string | null;
    description: string | null;
    /** The map's single scope (`wormholes`, `stargates`, `all`, `none`). */
    scope: string | null;
    /**
     * The scopes of a Wanderer that keeps several (`wormholes`, `hi`, `low`, `null`, `pochven`);
     * they win over `scope`. Older stored dumps lack it.
     */
    scopes?: string[] | null;
  };
  systems: WandererSystem[];
  connections: WandererConnection[];
  signatures: WandererSignature[];
  structures: WandererStructure[];
  comments: WandererComment[];
  /**
   * Ships seen going through connections, when the source has them one by one (an export file's
   * `passages`, or an instance that offers them over JSON:API). Older stored dumps lack it.
   */
  passages?: WandererPassage[];
  acls: WandererAcl[];
  /**
   * Wanderer map hubs (solar system ids): the settings export's `hubs`, or the hubs the map's
   * users set (`map_user_settings`), most used first.
   */
  hubs: number[];
  /** The map's webhook subscriptions (API only; their signing secrets are never read). */
  webhooks?: WandererWebhook[];
  /** Names of the map's own system labels by id (export version 2: `map.system_labels`). */
  labelNames: Record<string, string>;
  /**
   * The map's label list (`system_labels`: id, name, description) in order; empty when Wanderer
   * uses its defaults (A, B, C, 1, 2, 3). Older stored dumps lack it (then `labelNames`).
   */
  systemLabels?: WandererLabel[];
  /** Tracked characters Wanderer listed (they are reported, not imported). */
  trackedCharacters: number;
  /** Problems reading the source that did not stop the import. */
  warnings: string[];
  /** Rows the readers could not understand, per kind. */
  rejected: Record<string, number>;
  /** When the source was read; also the "last changed" time of rows without one (files). */
  readAt: number;
}

export interface WandererSystem {
  /** Wanderer's own id of the system on the map (API only); signatures and comments refer to it. */
  uuid: string | null;
  solarSystemId: number;
  customName: string | null;
  /**
   * Wanderer's own `name` of the system where the source does not say whether it is the real one
   * (export files, JSON:API): a name other than the system's real name is the one someone gave
   * it, and wins over `customName` as it does in Wanderer. Older stored dumps lack it.
   */
  rawName?: string | null;
  temporaryName: string | null;
  description: string | null;
  tag: string | null;
  labels: { ids: string[]; custom: string | null };
  /** Wanderer status code (0-8) or name. */
  status: number | string | null;
  visible: boolean;
  locked: boolean;
  position: { x: number; y: number } | null;
  insertedAt: number | null;
  updatedAt: number | null;
}

export interface WandererConnection {
  source: number;
  target: number;
  /** 0 wormhole, 1 gate, 2 bridge. */
  type: number | null;
  /** 0 more than half, 1 less than half, 2 critical. */
  massStatus: number | null;
  /** 0 normal, 1 EOL 1 h, 2 EOL 4 h, 3 EOL 4.5 h, 4 16 h, 5 24 h, 6 48 h. */
  timeStatus: number | null;
  /** 0 frigate, 1 medium, 2 large, 3 freight, 4 capital. */
  shipSizeType: number | null;
  wormholeType: string | null;
  locked: boolean;
  dangerous: boolean | null;
  /** 0 none, 1 source, 2 target, 3 both. */
  bubbled: number | null;
  customInfo: string | null;
  /** When the mass status was last set (JSON:API `mass_status_updated_at`), where known. */
  massStatusAt?: number | null;
  countOfPassage: number | null;
  insertedAt: number | null;
  updatedAt: number | null;
}

export interface WandererSignature {
  systemUuid: string | null;
  solarSystemId: number | null;
  eveId: string;
  name: string | null;
  temporaryName: string | null;
  description: string | null;
  /** `Cosmic Signature`, `Cosmic Anomaly`, `Structure`... (also `cosmic_signature`). */
  kind: string | null;
  /** `Wormhole`, `Data Site`, `Relic Site`, `Gas Site`, `Ore Site`, `Combat Site`... */
  group: string | null;
  type: string | null;
  /** JSON text Wanderer keeps per signature (time and mass marks, bookmark index...). */
  customInfo: string | null;
  linkedSystemId: number | null;
  characterEveId: string | null;
  insertedAt: number | null;
  updatedAt: number | null;
}

export interface WandererStructure {
  /** Wanderer's id of the structure; null in files that have none. */
  id: string | null;
  systemUuid: string | null;
  solarSystemId: number | null;
  name: string | null;
  type: string | null;
  typeId: string | null;
  ownerName: string | null;
  ownerTicker: string | null;
  /** The owning corporation, when Wanderer knew its id. */
  ownerId: number | null;
  status: string | null;
  endTime: number | null;
  notes: string | null;
  /** Who added it. */
  characterEveId: string | null;
  insertedAt: number | null;
  updatedAt: number | null;
}

export interface WandererComment {
  /** Wanderer's id of the comment; null in files that have none. */
  id: string | null;
  systemUuid: string | null;
  solarSystemId: number | null;
  text: string;
  insertedAt: number | null;
  /** Who wrote it, when the source says (a name, or a character id to look up). */
  authorName: string | null;
  authorEveId: string | null;
}

export interface WandererPassage {
  /** Wanderer's id of the passage; null in files that have none. */
  id: string | null;
  source: number;
  target: number;
  characterEveId: number;
  shipTypeId: number | null;
  at: number | null;
}

export interface WandererLabel {
  id: string;
  name: string;
  description: string | null;
}

export interface WandererWebhook {
  /** Wanderer's id of the subscription; null when it gives none (the URL stands in). */
  id: string | null;
  url: string;
  /** Wanderer event names (`add_system`, `connection_updated`, `*`...). */
  events: string[];
  active: boolean;
}

export interface WandererAcl {
  id: string;
  name: string;
  /** Null when the members could not be read (the ACL's own API key is needed). */
  members: WandererAclMember[] | null;
  error: string | null;
}

export interface WandererAclMember {
  kind: 'character' | 'corporation' | 'alliance';
  eveId: string;
  name: string | null;
  role: string;
}

// ---- readers ------------------------------------------------------------------------------------

type Row = Record<string, unknown>;

export function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `12`, `"12"`, `12.0` -> 12; anything else null. */
export function int(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Math.round(Number(value));
  return null;
}

function eveIdNumber(value: unknown): number | null {
  const n = int(value);
  return n !== null && n > 0 && Number.isSafeInteger(n) ? n : null;
}

export function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number') return String(value);
  return null;
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/** ISO 8601 (Wanderer's timestamps, with or without zone) or epoch ms/s -> epoch ms. */
export function time(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Wanderer labels: JSON `{"customLabel": "...", "labels": ["a", "1"]}`, a comma list
 * (`"market,hub"`), an array, or nothing.
 */
export function readLabels(value: unknown): { ids: string[]; custom: string | null } {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return { ids: [], custom: null };
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return { ids: split(trimmed), custom: null };
    }
  }
  if (Array.isArray(raw)) return { ids: raw.map(text).filter((v): v is string => v !== null), custom: null };
  if (isRow(raw)) {
    const ids = Array.isArray(raw.labels)
      ? raw.labels.map(text).filter((v): v is string => v !== null)
      : typeof raw.labels === 'string'
        ? split(raw.labels)
        : [];
    return { ids, custom: text(raw.customLabel)?.trim() ?? null };
  }
  return { ids: [], custom: null };
}

const split = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function position(row: Row): { x: number; y: number } | null {
  if (isRow(row.position)) {
    const x = Number(row.position.x);
    const y = Number(row.position.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  const x = Number(row.position_x);
  const y = Number(row.position_y);
  return row.position_x !== undefined && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * A system row: the REST API's (`/api/maps/:map/systems`: `name` is the name shown, temporary
 * name first, `custom_name` already resolved, `original_name` the real one), an export file's or
 * a flattened JSON:API `map_systems` resource (Wanderer's own `name` and `custom_name`).
 */
export function readSystem(row: unknown): WandererSystem | null {
  if (!isRow(row)) return null;
  // The settings export keys systems by `id` (the solar system id as a string).
  const solarSystemId = eveIdNumber(row.solar_system_id) ?? eveIdNumber(row.id);
  if (solarSystemId === null) return null;
  const uuid = typeof row.id === 'string' && !/^\d+$/.test(row.id) ? row.id : null;
  const custom = text(row.custom_name);
  const shown = text(row.name);
  const temporary = text(row.temporary_name);
  const original = text(row.original_name) ?? text(row.solar_system_name);
  // With the real name at hand, a shown name that is neither it nor the temporary one is custom
  // (for APIs that do not resolve `custom_name`); without it, the translation compares.
  const customName =
    custom ?? (shown && original && shown !== original && shown !== temporary ? shown : null);
  return {
    uuid,
    solarSystemId,
    customName,
    rawName: original ? null : shown,
    temporaryName: temporary,
    description: text(row.description),
    tag: text(row.tag),
    labels: readLabels(row.labels),
    status: typeof row.status === 'string' && !/^\d+$/.test(row.status) ? row.status : int(row.status),
    visible: bool(row.visible) ?? true,
    locked: bool(row.locked) ?? false,
    position: position(row),
    insertedAt: time(row.inserted_at),
    updatedAt: time(row.updated_at),
  };
}

/** A connection row (`solar_system_source/target` from the API, `source/target` in exports). */
export function readConnection(row: unknown): WandererConnection | null {
  if (!isRow(row)) return null;
  const source = eveIdNumber(row.solar_system_source) ?? eveIdNumber(row.source);
  const target = eveIdNumber(row.solar_system_target) ?? eveIdNumber(row.target);
  if (source === null || target === null || source === target) return null;
  return {
    source,
    target,
    type: int(row.type),
    massStatus: int(row.mass_status),
    timeStatus: int(row.time_status),
    shipSizeType: int(row.ship_size_type),
    wormholeType: text(row.wormhole_type),
    locked: bool(row.locked) ?? false,
    dangerous: bool(row.dangerous),
    bubbled: int(row.bubbled),
    customInfo: text(row.custom_info),
    massStatusAt: time(row.mass_status_updated_at),
    countOfPassage: int(row.count_of_passage),
    insertedAt: time(row.inserted_at),
    updatedAt: time(row.updated_at),
  };
}

export function readSignature(row: unknown): WandererSignature | null {
  if (!isRow(row)) return null;
  const eveId = text(row.eve_id);
  if (!eveId) return null;
  return {
    systemUuid: text(row.system_id),
    solarSystemId: eveIdNumber(row.solar_system_id),
    eveId,
    name: text(row.name),
    temporaryName: text(row.temporary_name),
    description: text(row.description),
    kind: text(row.kind),
    group: text(row.group),
    type: text(row.type),
    customInfo:
      typeof row.custom_info === 'string'
        ? text(row.custom_info)
        : isRow(row.custom_info)
          ? JSON.stringify(row.custom_info)
          : null,
    linkedSystemId: eveIdNumber(row.linked_system_id),
    characterEveId: text(row.character_eve_id),
    insertedAt: time(row.inserted_at),
    updatedAt: time(row.updated_at),
  };
}

export function readStructure(row: unknown): WandererStructure | null {
  if (!isRow(row)) return null;
  const structure: WandererStructure = {
    id: text(row.id),
    systemUuid: text(row.system_id),
    solarSystemId: eveIdNumber(row.solar_system_id),
    name: text(row.name),
    type: text(row.structure_type),
    typeId: text(row.structure_type_id),
    ownerName: text(row.owner_name),
    ownerTicker: text(row.owner_ticker),
    ownerId: eveIdNumber(row.owner_id),
    status: text(row.status),
    endTime: time(row.end_time),
    notes: text(row.notes),
    characterEveId: text(row.character_eve_id),
    insertedAt: time(row.inserted_at),
    updatedAt: time(row.updated_at),
  };
  return structure.solarSystemId !== null || structure.systemUuid !== null ? structure : null;
}

/**
 * A system comment: `{solar_system_id, text}` in exports, a JSON:API resource
 * (`attributes.text`, `relationships.system.data.id`) from `/api/v1/map_system_comments`.
 */
export function readComment(row: unknown): WandererComment | null {
  if (!isRow(row)) return null;
  const attributes = isRow(row.attributes) ? row.attributes : row;
  const commentText = text(attributes.text);
  if (!commentText) return null;
  const relationships = isRow(row.relationships) ? row.relationships : null;
  const system = relationships && isRow(relationships.system) ? relationships.system : null;
  const systemData = system && isRow(system.data) ? system.data : null;
  const character = isRow(attributes.character) ? attributes.character : null;
  return {
    id: text(row.id) ?? text(attributes.id),
    systemUuid: text(attributes.system_id) ?? (systemData ? text(systemData.id) : null),
    solarSystemId: eveIdNumber(attributes.solar_system_id),
    text: commentText,
    insertedAt: time(attributes.inserted_at),
    authorName: text(attributes.character_name) ?? (character ? text(character.name) : null),
    authorEveId: text(attributes.character_eve_id) ?? (character ? text(character.eve_id) : null),
  };
}

/**
 * A passage: `solar_system_source_id`/`solar_system_target_id` (or `source`/`target`), the
 * character (`character_eve_id`, or `character.eve_id`), `ship_type_id` and when.
 */
export function readPassage(row: unknown): WandererPassage | null {
  if (!isRow(row)) return null;
  const attributes = isRow(row.attributes) ? { id: row.id, ...row.attributes } : row;
  const source = eveIdNumber(attributes.solar_system_source_id) ?? eveIdNumber(attributes.source);
  const target = eveIdNumber(attributes.solar_system_target_id) ?? eveIdNumber(attributes.target);
  const character = isRow(attributes.character) ? attributes.character : null;
  const characterEveId =
    eveIdNumber(attributes.character_eve_id) ?? (character ? eveIdNumber(character.eve_id) : null);
  if (source === null || target === null || source === target || characterEveId === null) return null;
  return {
    id: text(attributes.id),
    source,
    target,
    characterEveId,
    shipTypeId: eveIdNumber(attributes.ship_type_id),
    at: time(attributes.inserted_at) ?? time(attributes.at),
  };
}

/** A member of `GET /api/acls/:id`: exactly one of eve_character_id, eve_corporation_id, eve_alliance_id. */
export function readAclMember(row: unknown): WandererAclMember | null {
  if (!isRow(row)) return null;
  const role = text(row.role)?.toLowerCase() ?? 'viewer';
  const name = text(row.name);
  for (const [key, kind] of [
    ['eve_character_id', 'character'],
    ['eve_corporation_id', 'corporation'],
    ['eve_alliance_id', 'alliance'],
  ] as const) {
    const id = eveIdNumber(row[key]);
    if (id !== null) return { kind, eveId: String(id), name, role };
  }
  return null;
}

/** Reads every row of a list with `read`, counting the ones it could not understand. */
export function readAll<T>(
  rows: unknown,
  read: (row: unknown) => T | null,
  kind: string,
  rejected: Record<string, number>,
): T[] {
  if (!Array.isArray(rows)) return [];
  const out: T[] = [];
  for (const row of rows) {
    const item = read(row);
    if (item) out.push(item);
    else rejected[kind] = (rejected[kind] ?? 0) + 1;
  }
  return out;
}

/**
 * A map's `system_labels`: `[{id, name, color, description}]`, `{id: name}`, `{labels: [...]}`, or
 * any of them as JSON text, so a change of serialisation does not lose them. Colour is dropped.
 */
export function readSystemLabels(value: unknown): WandererLabel[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const out: WandererLabel[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRow(entry)) continue;
      const id = text(entry.id) ?? text(entry.value);
      const name = text(entry.name) ?? text(entry.label);
      if (id && name) out.push({ id, name, description: text(entry.description) });
    }
  } else if (isRow(raw)) {
    if (Array.isArray(raw.labels)) return readSystemLabels(raw.labels);
    for (const [id, name] of Object.entries(raw))
      if (typeof name === 'string' && name.trim()) out.push({ id, name, description: null });
  }
  return out;
}

/** A webhook subscription (`GET /api/maps/:map/webhooks`): `url`, `events`, `active`. */
export function readWebhook(row: unknown): WandererWebhook | null {
  if (!isRow(row)) return null;
  const url = text(row.url);
  if (!url) return null;
  const events = Array.isArray(row.events)
    ? row.events.map(text).filter((e): e is string => e !== null)
    : typeof row.events === 'string'
      ? split(row.events)
      : [];
  return { id: text(row.id), url: url.trim(), events, active: bool(row.active) ?? true };
}

/**
 * Hubs of a map's user settings (`map_user_settings`, attribute `hubs`: solar system ids as
 * strings), most used first.
 */
export function readUserHubs(rows: unknown, mapId: string | null): number[] {
  if (!Array.isArray(rows)) return [];
  const uses = new Map<number, number>();
  for (const row of rows) {
    if (!isRow(row)) continue;
    if (mapId && text(row.map_id) && text(row.map_id) !== mapId) continue;
    const hubs = Array.isArray(row.hubs) ? row.hubs : [];
    for (const hub of hubs) {
      const id = eveIdNumber(hub);
      if (id) uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }
  return [...uses].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** An empty dump to fill. */
export function emptyDump(source: ImportSourceDto, readAt: number): WandererMapDump {
  return {
    source,
    map: {
      name: source.name,
      slug: source.kind === 'wanderer-api' ? source.slug : null,
      description: null,
      scope: null,
      scopes: null,
    },
    systems: [],
    connections: [],
    signatures: [],
    structures: [],
    comments: [],
    passages: [],
    acls: [],
    hubs: [],
    webhooks: [],
    labelNames: {},
    systemLabels: [],
    trackedCharacters: 0,
    warnings: [],
    rejected: {},
    readAt,
  };
}
