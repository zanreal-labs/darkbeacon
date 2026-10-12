import type {
  Bubbled,
  ConnectionType,
  ImportCountsDto,
  ImportReportLineDto,
  MapScope,
  LifetimeMark,
  MassStatus,
  Position,
  ShipSize,
  SignatureGroup,
  SignatureKind,
  SystemStatus,
  TimeStatus,
} from '@darkbeacon/shared';
import { planAccess, type PlannedAccessRule } from './acl.js';
import { spreadLayout } from './layout.js';
import { ReportBuilder } from './report.js';
import type {
  WandererComment,
  WandererConnection,
  WandererMapDump,
  WandererSignature,
  WandererStructure,
  WandererSystem,
} from './wanderer.js';

// ---- the plan: Darkbeacon-shaped data, keyed by stable external ids ------------------------------

/** System attributes as Darkbeacon keeps them; labels by their plan key until the map has ids. */
export interface SystemFields {
  position: Position;
  customName: string | null;
  temporaryName: string | null;
  tag: string | null;
  status: SystemStatus;
  description: string;
  locked: boolean;
  visible: boolean;
  labelKeys: string[];
}

export interface PlannedSystem {
  /** Stable external id: the solar system id. */
  key: string;
  solarSystemId: number;
  /** For reports: the real name (or the id). */
  name: string;
  fields: SystemFields;
  createdAt: number | null;
  /** When Wanderer last changed it (the export time for files); null when unknown. */
  remoteUpdatedAt: number | null;
  /** Wanderer fields Darkbeacon has no place for, kept with the import record. */
  extra: Record<string, unknown> | null;
}

export interface PlannedLabel {
  /** `label:<wanderer id>` or `label:custom:<name>`. */
  key: string;
  name: string;
  color: string;
  description: string;
}

export interface ConnectionFields {
  type: ConnectionType;
  timeStatus: TimeStatus;
  massStatus: MassStatus;
  shipSize: ShipSize;
  dangerous: boolean;
  bubbled: Bubbled;
  eolAt: number | null;
  massStatusAt: number | null;
  locked: boolean;
  note: string;
  lifetime: { mark: LifetimeMark; at: number } | null;
}

export interface PlannedConnection {
  /** `<lower id>-<higher id>`: one connection per pair. */
  key: string;
  source: number;
  target: number;
  name: string;
  fields: ConnectionFields;
  createdAt: number | null;
  remoteUpdatedAt: number | null;
  extra: Record<string, unknown> | null;
}

export interface SignatureFields {
  group: SignatureGroup;
  type: string | null;
  name: string | null;
  description: string;
  kind: SignatureKind;
  custom: boolean;
}

/** A ship seen going through a connection. */
export interface PlannedPassage {
  /** Wanderer's passage id, or `<pair>:<character>:<time>`. */
  key: string;
  source: number;
  target: number;
  characterId: number;
  shipTypeId: number | null;
  occurredAt: number;
}

export interface PlannedSignature {
  /** `<solar system id>:<ABC-123>`. */
  key: string;
  solarSystemId: number;
  eveId: string;
  name: string;
  fields: SignatureFields;
  /** The system the signature leads to; linked to the connection between them when there is one. */
  linkedTo: number | null;
  createdAt: number | null;
  remoteUpdatedAt: number | null;
  extra: Record<string, unknown> | null;
}

export interface ImportPlan {
  mapName: string;
  mapSlug: string | null;
  labels: PlannedLabel[];
  systems: PlannedSystem[];
  connections: PlannedConnection[];
  signatures: PlannedSignature[];
  passages: PlannedPassage[];
  access: PlannedAccessRule[];
  hubs: number[];
  /** Auto-mapping scopes from the Wanderer map scope; null when unknown. */
  scopes: MapScope[] | null;
  /** The factor positions were spread by (keep it for later pulls, so nothing jumps). */
  layoutScale: number;
}

export interface TranslateContext {
  /** The system's real name, or null when the universe does not know the id. */
  systemName(solarSystemId: number): string | null;
  /** The factor to spread positions by, when an earlier import chose one. */
  layoutScale?: number | null;
  /** A character's name (ESI), for who added a structure or wrote a comment; null when unknown. */
  characterName?(eveId: string): string | null;
}

export interface Translation {
  plan: ImportPlan;
  report: ImportReportLineDto[];
  counts: ImportCountsDto;
}

// ---- value maps ---------------------------------------------------------------------------------

/** Wanderer system status codes (API docs: 0 unknown ... 8 home). */
const STATUS_NAMES = [
  'unknown',
  'friendly',
  'warning',
  'targetPrimary',
  'targetSecondary',
  'dangerousPrimary',
  'dangerousSecondary',
  'lookingFor',
  'home',
] as const;

const STATUS: Record<string, { status: SystemStatus; label?: string; approx?: string }> = {
  unknown: { status: 'unknown' },
  friendly: { status: 'friendly' },
  warning: { status: 'warning' },
  targetprimary: { status: 'target' },
  targetsecondary: {
    status: 'target',
    label: 'Secondary',
    approx: 'Target (secondary) became Target with a "Secondary" label',
  },
  dangerousprimary: { status: 'hostile' },
  dangeroussecondary: {
    status: 'hostile',
    label: 'Secondary',
    approx: 'Dangerous (secondary) became Hostile with a "Secondary" label',
  },
  lookingfor: { status: 'unknown', label: 'Looking for', approx: 'Looking for became a label' },
  home: { status: 'home' },
  // Older API answers and examples use plain words.
  clear: { status: 'empty', approx: 'Clear became Empty' },
  hostile: { status: 'hostile' },
  target: { status: 'target' },
  empty: { status: 'empty' },
  occupied: { status: 'occupied' },
};

/** Wanderer's built-in label ids and how they are named in its UI. */
const BUILT_IN_LABELS: Record<string, string> = {
  a: 'Label A',
  b: 'Label B',
  c: 'Label C',
  '1': 'Label 1',
  '2': 'Label 2',
  '3': 'Label 3',
};

/** Label colours, in order of first use (labels are user data; these are only a start). */
const LABEL_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#84cc16'];

const SHIP_SIZES: Record<number, { size: ShipSize; approx?: string }> = {
  0: { size: 'small' },
  1: { size: 'medium' },
  2: { size: 'large' },
  3: { size: 'xlarge' },
  4: { size: 'capital' },
};

const CONNECTION_TYPES: Record<number, ConnectionType> = { 0: 'wormhole', 1: 'gate', 2: 'bridge' };
const MASS: Record<number, MassStatus> = { 0: 'fresh', 1: 'reduced', 2: 'critical' };
const BUBBLED: Record<number, Bubbled> = { 0: 'none', 1: 'source', 2: 'target', 3: 'both' };

const HOUR = 3_600_000;
/**
 * Wanderer's time codes: "less than N hours left" when it was marked (its UI says so for each).
 * 1 h and 4 h are end of life; the others say how long a younger hole may live at most.
 */
const LIFETIME_CODES: Record<number, LifetimeMark> = {
  1: '1h',
  2: '4h',
  3: '4.5h',
  4: '16h',
  5: '24h',
  6: '48h',
};

const SIGNATURE_GROUPS: Record<string, SignatureGroup> = {
  wormhole: 'wormhole',
  combat: 'combat',
  relic: 'relic',
  data: 'data',
  gas: 'gas',
  ore: 'ore',
  cosmic: 'unknown',
  unknown: 'unknown',
};

const SCOPES: Record<string, MapScope[]> = {
  wormholes: ['wormhole'],
  wormhole: ['wormhole'],
  stargates: ['high', 'low', 'null'],
  all: ['wormhole', 'high', 'low', 'null', 'pochven'],
  none: [],
};

const LIMITS = {
  connectionNote: 2000,
  customName: 64,
  temporaryName: 64,
  tag: 16,
  description: 10_000,
  sigName: 128,
  sigType: 64,
  sigDescription: 2000,
  label: 32,
};
const SIGNATURE_ID = /^[A-Z]{3}-\d{3}$/;
const CUSTOM_ID_MAX = 32;

// ---- translation --------------------------------------------------------------------------------

/**
 * Translates a Wanderer map into Darkbeacon terms, with the report of what came over as it was,
 * what was approximated and what was left out. Pure: the same dump gives the same plan.
 */
export function translate(dump: WandererMapDump, context: TranslateContext): Translation {
  const report = new ReportBuilder();
  const labels = new LabelSet(dump.labelNames);
  const systemsByUuid = new Map<string, number>();
  for (const s of dump.systems) if (s.uuid) systemsByUuid.set(s.uuid, s.solarSystemId);
  const nameOf = (id: number) => context.systemName(id) ?? String(id);

  for (const [kind, count] of Object.entries(dump.rejected)) {
    for (let i = 0; i < count; i++)
      report.dropped(
        kind.replace(/s$/, ''),
        'Unreadable row',
        'Wanderer sent something Darkbeacon could not read',
      );
  }

  // Systems ------------------------------------------------------------------------------------
  const seen = new Set<number>();
  const kept: WandererSystem[] = [];
  for (const system of dump.systems) {
    if (seen.has(system.solarSystemId)) continue;
    seen.add(system.solarSystemId);
    if (context.systemName(system.solarSystemId) === null) {
      report.dropped(
        'system',
        'Unknown solar system',
        'The id is not in the EVE universe data',
        String(system.solarSystemId),
      );
      continue;
    }
    kept.push(system);
  }
  const structures = groupBySystem(dump.structures, systemsByUuid);
  const comments = groupBySystem(dump.comments, systemsByUuid);
  const placed = kept.filter((s) => s.position);
  const layout = context.layoutScale
    ? { positions: placed.map((s) => scaled(s.position!, context.layoutScale!)), scale: context.layoutScale }
    : spreadLayout(placed.map((s) => s.position!));
  const positions = new Map(placed.map((s, i) => [s.solarSystemId, layout.positions[i]!]));
  if (layout.scale > 1 && !context.layoutScale)
    report.approximated(
      'system',
      `Positions spread ×${layout.scale}`,
      "Darkbeacon's systems are larger than Wanderer's, so the layout was widened to keep them apart",
    );

  const systems: PlannedSystem[] = [];
  let unplaced = 0;
  for (const system of kept) {
    const name = nameOf(system.solarSystemId);
    const extra: Record<string, unknown> = {};
    const status = systemStatus(system.status, report, name);
    const labelKeys: string[] = [];
    for (const id of system.labels.ids) labelKeys.push(labels.forWanderer(id));
    if (system.labels.custom) labelKeys.push(labels.custom(system.labels.custom, report, name));
    if (status.label) labelKeys.push(labels.custom(status.label, null, name));

    let position = positions.get(system.solarSystemId);
    if (!position) {
      position = { x: 0, y: 360 * 3 + unplaced++ * 150 };
      report.approximated('system', 'No position', 'Placed below the chain', name);
    }
    const description = composeDescription(
      system,
      structures.get(system.solarSystemId) ?? [],
      comments.get(system.solarSystemId) ?? [],
      report,
      name,
      (eveId) => context.characterName?.(eveId) ?? null,
    );
    const fields: SystemFields = {
      position,
      customName: cut(system.customName, LIMITS.customName, 'system', 'Name', report, name),
      temporaryName: cut(
        system.temporaryName,
        LIMITS.temporaryName,
        'system',
        'Temporary name',
        report,
        name,
      ),
      tag: cut(system.tag, LIMITS.tag, 'system', 'Tag', report, name),
      status: status.status,
      description,
      locked: system.locked,
      visible: system.visible,
      labelKeys: [...new Set(labelKeys)].slice(0, 16),
    };
    report.mapped('system', system.visible ? 'System' : 'Hidden system (kept with its intel)', name);
    systems.push({
      key: String(system.solarSystemId),
      solarSystemId: system.solarSystemId,
      name,
      fields,
      createdAt: system.insertedAt,
      remoteUpdatedAt: system.updatedAt ?? dump.readAt,
      extra: Object.keys(extra).length > 0 ? extra : null,
    });
  }
  const onMap = new Map(systems.map((s) => [s.solarSystemId, s]));
  const visible = (id: number) => onMap.get(id)?.fields.visible === true;

  // Connections --------------------------------------------------------------------------------
  const connections: PlannedConnection[] = [];
  const pairs = new Set<string>();
  const wormholeTypes = new Map<string, string>();
  for (const connection of dump.connections) {
    const name = `${nameOf(connection.source)} ↔ ${nameOf(connection.target)}`;
    const key = pairKey(connection.source, connection.target);
    if (pairs.has(key)) {
      report.dropped(
        'connection',
        'Second connection between the same systems',
        'Darkbeacon keeps one connection per pair',
        name,
      );
      continue;
    }
    if (!onMap.has(connection.source) || !onMap.has(connection.target)) {
      report.dropped(
        'connection',
        'Connection to a system that is not imported',
        'Both systems must be on the map',
        name,
      );
      continue;
    }
    if (!visible(connection.source) || !visible(connection.target)) {
      report.dropped(
        'connection',
        'Connection to a hidden system',
        'Hidden systems have no connections in Darkbeacon',
        name,
      );
      continue;
    }
    pairs.add(key);
    connections.push(translateConnection(connection, key, name, dump.readAt, report));
    if (connection.wormholeType) wormholeTypes.set(key, connection.wormholeType.toUpperCase());
  }

  // Signatures ---------------------------------------------------------------------------------
  const signatures: PlannedSignature[] = [];
  const sigKeys = new Set<string>();
  for (const signature of dump.signatures) {
    const solarSystemId =
      signature.solarSystemId ??
      (signature.systemUuid ? (systemsByUuid.get(signature.systemUuid) ?? null) : null);
    const scannerId = signature.eveId.trim().toUpperCase();
    // Ids that are not the scanner's (`ABC-123`) are entries someone wrote: kept as custom.
    const custom = !SIGNATURE_ID.test(scannerId);
    const eveId = custom ? signature.eveId.trim().slice(0, CUSTOM_ID_MAX) : scannerId;
    const where = solarSystemId ? nameOf(solarSystemId) : '?';
    const name = `${eveId} in ${where}`;
    if (!solarSystemId || !onMap.has(solarSystemId)) {
      report.dropped(
        'signature',
        'Signature of a system that is not imported',
        'Its system is not on the map',
        name,
      );
      continue;
    }
    if (custom && signature.eveId.trim().length > CUSTOM_ID_MAX)
      report.approximated('signature', 'Custom id cut to 32 characters', 'Darkbeacon keeps up to 32', name);
    const key = `${solarSystemId}:${eveId}`;
    if (sigKeys.has(key)) continue;
    sigKeys.add(key);
    signatures.push(
      translateSignature(signature, key, solarSystemId, eveId, custom, name, dump.readAt, report),
    );
  }
  linkSignatures(signatures, pairs, wormholeTypes, report, nameOf);
  // A type no signature carries is written in the connection's note, so it is not lost.
  for (const [key, code] of wormholeTypes) {
    const connection = connections.find((c) => c.key === key);
    if (!connection) continue;
    connection.fields.note = [connection.fields.note, `Wormhole type: ${code}`].filter(Boolean).join('\n');
    report.approximated(
      'connection',
      'Wormhole type kept in the connection note',
      'No signature leads through the connection, and Darkbeacon keeps wormhole types on signatures',
      `${code} ${connection.name}`,
    );
  }

  // Passages -----------------------------------------------------------------------------------
  const passages: PlannedPassage[] = [];
  const withDetails = new Set<string>();
  for (const passage of dump.passages ?? []) {
    const key = pairKey(passage.source, passage.target);
    if (!pairs.has(key)) {
      report.dropped(
        'passage',
        'Passage through a connection that is not imported',
        'Its connection is not on the map',
      );
      continue;
    }
    withDetails.add(key);
    passages.push({
      key: passage.id ?? `${key}:${passage.characterEveId}:${passage.at ?? 0}`,
      source: passage.source,
      target: passage.target,
      characterId: passage.characterEveId,
      shipTypeId: passage.shipTypeId,
      occurredAt: passage.at ?? dump.readAt,
    });
    report.mapped('passage', 'Passage with pilot and ship');
  }
  for (const connection of dump.connections) {
    const key = pairKey(connection.source, connection.target);
    if (!connection.countOfPassage || withDetails.has(key) || !pairs.has(key)) continue;
    report.dropped(
      'passage',
      `Passage count without details (${connection.countOfPassage})`,
      "Wanderer's API says how many ships passed, not who, in what or when; a bare count cannot feed mass estimates. It is kept in the import record",
      `${nameOf(connection.source)} ↔ ${nameOf(connection.target)}`,
    );
  }

  // Structures and comments that found no system ------------------------------------------------
  for (const s of dump.structures) {
    const id = s.solarSystemId ?? (s.systemUuid ? systemsByUuid.get(s.systemUuid) : undefined);
    if (!id || !onMap.has(id))
      report.dropped(
        'structure',
        'Structure of a system that is not imported',
        'Its system is not on the map',
        s.name ?? undefined,
      );
  }
  for (const c of dump.comments) {
    const id = c.solarSystemId ?? (c.systemUuid ? systemsByUuid.get(c.systemUuid) : undefined);
    if (!id || !onMap.has(id))
      report.dropped('comment', 'Comment on a system that is not imported', 'Its system is not on the map');
  }

  // Access, settings ---------------------------------------------------------------------------
  const access = planAccess(dump.acls, report);
  const hubs = [...new Set(dump.hubs)].filter((id) => context.systemName(id) !== null);
  if (hubs.length > 20) {
    report.dropped('setting', 'Hubs beyond the first 20', 'A Darkbeacon map has at most 20 hubs');
    hubs.length = 20;
  }
  if (hubs.length > 0) report.mapped('setting', `Map hubs (${hubs.length})`);
  const scopes = dump.map.scope ? (SCOPES[dump.map.scope.toLowerCase()] ?? null) : null;
  if (dump.map.scope && !scopes)
    report.dropped('setting', `Map scope "${dump.map.scope}"`, 'Darkbeacon has no equivalent');
  else if (scopes) report.mapped('setting', 'Auto-mapping scope');
  if (dump.map.description)
    report.dropped('setting', 'Map description', 'Darkbeacon maps have no description');
  if (dump.trackedCharacters > 0)
    report.dropped(
      'character',
      `Tracked characters (${dump.trackedCharacters})`,
      'Each pilot links their own characters in Darkbeacon with EVE sign-in',
    );
  for (const warning of dump.warnings) report.dropped('source', warning, 'Reported by the source');

  const plan: ImportPlan = {
    mapName: (dump.map.name ?? dump.source.name ?? dump.source.slug).slice(0, 64),
    mapSlug: dump.map.slug,
    labels: labels.list(),
    systems,
    connections,
    signatures,
    passages,
    access,
    hubs,
    scopes,
    layoutScale: layout.scale,
  };
  const counts: ImportCountsDto = {
    systems: systems.filter((s) => s.fields.visible).length,
    hiddenSystems: systems.filter((s) => !s.fields.visible).length,
    connections: connections.length,
    signatures: signatures.length,
    passages: passages.length,
    structures: dump.structures.length,
    comments: dump.comments.length,
    labels: plan.labels.length,
    accessRules: access.length,
    hubs: hubs.length,
  };
  return { plan, report: report.build(), counts };
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function scaled(p: Position, factor: number): Position {
  return { x: Math.round(p.x * factor), y: Math.round(p.y * factor) };
}

function systemStatus(
  value: number | string | null,
  report: ReportBuilder,
  name: string,
): { status: SystemStatus; label?: string } {
  if (value === null) return { status: 'unknown' };
  const key = (typeof value === 'number' ? (STATUS_NAMES[value] ?? `code ${value}`) : value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const found = STATUS[key];
  if (!found) {
    report.dropped(
      'system',
      `Status "${value}"`,
      'Darkbeacon has no such status; the system starts as Unknown',
      name,
    );
    return { status: 'unknown' };
  }
  if (found.approx) report.approximated('system', found.approx, 'Darkbeacon has fewer statuses', name);
  return found;
}

/**
 * Notes, then one titled block per structure and per comment Wanderer kept about the system
 * (who added it and when), as one text that reads well on its own.
 */
function composeDescription(
  system: WandererSystem,
  structures: WandererStructure[],
  comments: WandererComment[],
  report: ReportBuilder,
  name: string,
  characterName: (eveId: string) => string | null,
): string {
  const parts: string[] = [];
  if (system.description) parts.push(system.description.trim());
  const byTime = <T extends { insertedAt: number | null }>(list: T[]) =>
    [...list].sort((a, b) => (a.insertedAt ?? 0) - (b.insertedAt ?? 0));
  for (const structure of byTime(structures)) {
    parts.push(structureBlock(structure, characterName));
    report.mapped('structure', 'Structure, as a titled block in the system notes', name);
  }
  for (const comment of byTime(comments)) {
    parts.push(commentBlock(comment, characterName));
    report.mapped('comment', 'Comment, as a titled block in the system notes', name);
  }
  const text = parts.join('\n\n');
  if (text.length > LIMITS.description) {
    report.approximated(
      'system',
      'Notes cut to 10 000 characters',
      'Darkbeacon keeps up to 10 000 characters of notes',
      name,
    );
    return `${text.slice(0, LIMITS.description - 1)}…`;
  }
  return text;
}

/** `Added by Jane, 2026-10-11 (Wanderer)`, as much of it as is known. */
function byline(
  verb: string,
  eveId: string | null,
  knownName: string | null,
  at: number | null,
  characterName: (eveId: string) => string | null,
): string {
  const who = knownName ?? (eveId ? characterName(eveId) : null);
  const parts = [who ? `${verb} by ${who}` : verb, at ? moment(at) : null].filter(Boolean);
  return `${parts.join(', ')} (Wanderer)`;
}

function structureBlock(s: WandererStructure, characterName: (eveId: string) => string | null): string {
  const title = [s.type ?? 'Structure', s.name ? `“${s.name}”` : null].filter(Boolean).join(' ');
  const owner = s.ownerName
    ? `${s.ownerName}${s.ownerTicker ? ` [${s.ownerTicker}]` : ''}`
    : s.ownerTicker
      ? `[${s.ownerTicker}]`
      : null;
  const lines = [`Structure: ${title}`];
  if (owner) lines.push(`Owner: ${owner}`);
  if (s.status || s.endTime)
    lines.push(
      `Status: ${[s.status, s.endTime ? `timer ends ${moment(s.endTime)}` : null].filter(Boolean).join(', ')}`,
    );
  if (s.notes) lines.push(`Notes: ${s.notes.trim()}`);
  lines.push(byline('Added', s.characterEveId, null, s.insertedAt ?? s.updatedAt, characterName));
  return lines.join('\n');
}

function commentBlock(c: WandererComment, characterName: (eveId: string) => string | null): string {
  return [byline('Comment', c.authorEveId, c.authorName, c.insertedAt, characterName), c.text.trim()].join(
    '\n',
  );
}

function translateConnection(
  c: WandererConnection,
  key: string,
  name: string,
  readAt: number,
  report: ReportBuilder,
): PlannedConnection {
  const updatedAt = c.updatedAt ?? null;
  const extra: Record<string, unknown> = {};
  const type = CONNECTION_TYPES[c.type ?? 0];
  if (!type)
    report.approximated('connection', `Type code ${c.type} became Wormhole`, 'Unknown connection type', name);
  const size = SHIP_SIZES[c.shipSizeType ?? 2];
  if (!size)
    report.approximated(
      'connection',
      `Ship size code ${c.shipSizeType} became Large`,
      'Unknown ship size',
      name,
    );
  const mass = MASS[c.massStatus ?? 0];
  if (!mass)
    report.approximated('connection', `Mass code ${c.massStatus} became Fresh`, 'Unknown mass status', name);

  let timeStatus: TimeStatus = 'normal';
  let eolAt: number | null = null;
  let lifetime: ConnectionFields['lifetime'] = null;
  const mark = LIFETIME_CODES[c.timeStatus ?? 0];
  if (mark) {
    const markedAt = updatedAt ?? readAt;
    lifetime = { mark, at: markedAt };
    report.mapped('connection', `Lifetime mark "less than ${mark}" with the time it was set`, name);
    if (updatedAt === null)
      report.approximated(
        'connection',
        'Lifetime mark counted from the import',
        'Wanderer did not say when it was set',
        name,
      );
    if (mark === '1h' || mark === '4h') {
      timeStatus = 'eol';
      // Darkbeacon counts EOL as "less than 4 h left from eolAt"; Wanderer marks how much was left.
      eolAt = markedAt - (mark === '1h' ? 3 : 0) * HOUR;
    }
  } else if (c.timeStatus) {
    report.approximated('connection', `Time code ${c.timeStatus} became Normal`, 'Unknown time code', name);
  }
  const dangerous = c.dangerous ?? false;
  const bubbled = BUBBLED[c.bubbled ?? 0] ?? 'none';
  if (c.locked) report.mapped('connection', 'Lock', name);
  let note = '';
  if (c.customInfo) {
    note = c.customInfo.trim().slice(0, LIMITS.connectionNote);
    report.mapped('connection', 'Note (custom info)', name);
  }
  if (c.countOfPassage) extra.countOfPassage = c.countOfPassage;
  report.mapped(
    'connection',
    type === 'gate' ? 'Gate' : type === 'bridge' ? 'Jump bridge' : 'Wormhole',
    name,
  );
  const [source, target] = [c.source, c.target];
  return {
    key,
    source,
    target,
    name,
    fields: {
      type: type ?? 'wormhole',
      timeStatus,
      massStatus: mass ?? 'fresh',
      shipSize: size?.size ?? 'large',
      dangerous,
      bubbled,
      eolAt,
      massStatusAt: (mass ?? 'fresh') !== 'fresh' ? (updatedAt ?? readAt) : null,
      locked: c.locked,
      note,
      lifetime,
    },
    createdAt: c.insertedAt,
    remoteUpdatedAt: updatedAt ?? readAt,
    extra: Object.keys(extra).length > 0 ? extra : null,
  };
}

function translateSignature(
  s: WandererSignature,
  key: string,
  solarSystemId: number,
  eveId: string,
  custom: boolean,
  name: string,
  readAt: number,
  report: ReportBuilder,
): PlannedSignature {
  const extra: Record<string, unknown> = {};
  const kindText = (s.kind ?? 'cosmic signature')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
  const kind: SignatureKind =
    kindText === 'cosmic signature' ? 'signature' : kindText === 'cosmic anomaly' ? 'anomaly' : 'other';
  const rawGroup = (s.group ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s*site$/, '')
    .trim();
  const group = rawGroup === '' ? 'unknown' : SIGNATURE_GROUPS[rawGroup.split(' ')[0]!];
  if (!group)
    report.approximated(
      'signature',
      `Group "${s.group}" became Unknown`,
      'Darkbeacon has no such group',
      name,
    );
  let type = s.type ? s.type.trim() : null;
  // Other scanner rows (ships, structures...) keep what the scanner called them as their type.
  if (kind === 'other' && !type) type = titleCase(kindText);
  // "Wormhole" as a type says nothing the group does not; a code (K162, C247) is the type.
  if (type && /^wormhole$/i.test(type)) type = null;
  if (type && /^[A-Z]\d{3}$/i.test(type)) type = type.toUpperCase();
  const notes: string[] = [];
  if (s.description) notes.push(s.description.trim());
  if (s.temporaryName) {
    notes.push(`Bookmark: ${s.temporaryName}`);
    report.approximated(
      'signature',
      'Bookmark name kept in the description',
      'Darkbeacon signatures have no bookmark name',
      name,
    );
  }
  if (s.customInfo) {
    const info = parseInfo(s.customInfo);
    if (info) extra.customInfo = info;
    // A linked hole's marks are the connection's; an unlinked one keeps them in words.
    const marks = s.linkedSystemId === null ? infoNotes(info) : null;
    if (marks) {
      notes.push(marks);
      report.approximated(
        'signature',
        'Marks of an unlinked hole kept in the description',
        'Darkbeacon keeps time, mass and destination on the connection, and there is none yet',
        name,
      );
    }
  }
  if (s.characterEveId) extra.scannedBy = s.characterEveId;
  let description = notes.join('\n');
  if (description.length > LIMITS.sigDescription) {
    description = `${description.slice(0, LIMITS.sigDescription - 1)}…`;
    report.approximated(
      'signature',
      'Description cut to 2 000 characters',
      'Darkbeacon keeps up to 2 000',
      name,
    );
  }
  report.mapped(
    'signature',
    kind === 'signature'
      ? `${titleCase(group ?? 'unknown')} signature${custom ? ' (custom entry)' : ''}`
      : kind === 'anomaly'
        ? `${titleCase(group ?? 'unknown')} anomaly`
        : `Other scanner result (${type ?? 'unknown'})${custom ? ', custom entry' : ''}`,
    name,
  );
  return {
    key,
    solarSystemId,
    eveId,
    name,
    fields: {
      group: group ?? 'unknown',
      type: type ? type.slice(0, LIMITS.sigType) : null,
      name: s.name ? s.name.slice(0, LIMITS.sigName) : null,
      description,
      kind,
      custom,
    },
    linkedTo: s.linkedSystemId,
    createdAt: s.insertedAt,
    remoteUpdatedAt: s.updatedAt ?? readAt,
    extra: Object.keys(extra).length > 0 ? extra : null,
  };
}

/**
 * Signatures that lead to a system the map connects become linked (and wormholes). A
 * connection's wormhole type goes to a linked signature on its source side that has none.
 */
function linkSignatures(
  signatures: PlannedSignature[],
  pairs: Set<string>,
  wormholeTypes: Map<string, string>,
  report: ReportBuilder,
  nameOf: (id: number) => string,
): void {
  for (const s of signatures) {
    if (s.linkedTo === null) continue;
    const key = pairKey(s.solarSystemId, s.linkedTo);
    if (!pairs.has(key)) {
      report.dropped(
        'signature',
        'Link to a system without a connection',
        'Darkbeacon links a signature to a connection',
        `${s.name} → ${nameOf(s.linkedTo)}`,
      );
      s.linkedTo = null;
      continue;
    }
    s.fields.group = 'wormhole';
    const code = wormholeTypes.get(key);
    if (code && !s.fields.type) {
      // Wanderer's wormhole type is the type of the hole on the source side; K162 the other side.
      s.fields.type = code;
      report.mapped('signature', 'Wormhole type from the connection', s.name);
    }
    if (code) wormholeTypes.delete(key);
  }
}

class LabelSet {
  private readonly byKey = new Map<string, PlannedLabel>();
  constructor(private readonly names: Record<string, string>) {}

  forWanderer(id: string): string {
    const normal = /^l[abc123]$/.test(id) ? id.slice(1) : id;
    const key = `label:${normal}`;
    if (!this.byKey.has(key)) {
      const name = (this.names[id] ?? this.names[normal] ?? BUILT_IN_LABELS[normal] ?? normal).slice(
        0,
        LIMITS.label,
      );
      this.add(key, name, 'From Wanderer');
    }
    return this.byKey.get(key)!.key;
  }

  custom(name: string, report: ReportBuilder | null, example: string): string {
    const trimmed = name.trim().slice(0, LIMITS.label);
    const key = `label:custom:${trimmed.toLowerCase()}`;
    if (!this.byKey.has(key)) this.add(key, trimmed, 'From Wanderer');
    report?.approximated(
      'system',
      'Custom label became a map label',
      'Darkbeacon labels are shared by the map',
      example,
    );
    return this.byKey.get(key)!.key;
  }

  private add(key: string, name: string, description: string): void {
    // Two Wanderer labels with one name (case aside) are one Darkbeacon label.
    for (const label of this.byKey.values())
      if (label.name.toLowerCase() === name.toLowerCase()) {
        this.byKey.set(key, label);
        return;
      }
    const color = LABEL_COLORS[new Set(this.byKey.values()).size % LABEL_COLORS.length]!;
    this.byKey.set(key, { key, name, color, description });
  }

  list(): PlannedLabel[] {
    return [...new Set(this.byKey.values())];
  }
}

function groupBySystem<T extends { solarSystemId: number | null; systemUuid: string | null }>(
  items: readonly T[],
  byUuid: Map<string, number>,
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const item of items) {
    const id = item.solarSystemId ?? (item.systemUuid ? byUuid.get(item.systemUuid) : undefined);
    if (!id) continue;
    let list = out.get(id);
    if (!list) out.set(id, (list = []));
    list.push(item);
  }
  return out;
}

function cut(
  value: string | null,
  max: number,
  kind: string,
  what: string,
  report: ReportBuilder,
  example: string,
): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed || null;
  report.approximated(kind, `${what} cut to ${max} characters`, `Darkbeacon keeps up to ${max}`, example);
  return trimmed.slice(0, max);
}

/** Wanderer's marks on a signature (`custom_info`) in words, for an unlinked hole. */
function infoNotes(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null;
  const i = info as Record<string, unknown>;
  const parts: string[] = [];
  const mark = typeof i.time_status === 'number' ? LIFETIME_CODES[i.time_status] : undefined;
  if (mark) parts.push(`less than ${mark} left`);
  const mass = typeof i.mass_status === 'number' ? MASS[i.mass_status] : undefined;
  if (mass && mass !== 'fresh') parts.push(`mass ${mass}`);
  if (typeof i.destType === 'string' && i.destType) parts.push(`leads to ${i.destType}`);
  if (typeof i.k162Type === 'string' && i.k162Type) parts.push(`K162 from ${i.k162Type}`);
  if (i.isCrit === true) parts.push('critical');
  if (i.isBubbled === true) parts.push('bubbled');
  return parts.length > 0 ? `Wanderer marks: ${parts.join(', ')}` : null;
}

function parseInfo(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return text;
  }
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const moment = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
