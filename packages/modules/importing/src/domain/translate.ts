import type {
  Bubbled,
  ConnectionType,
  ImportCountsDto,
  ImportReportLineDto,
  MapScope,
  MassStatus,
  Position,
  ShipSize,
  SignatureGroup,
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
  targetsecondary: { status: 'target', approx: 'Target (secondary) became Target' },
  dangerousprimary: { status: 'hostile', approx: 'Dangerous became Hostile' },
  dangeroussecondary: { status: 'hostile', approx: 'Dangerous (secondary) became Hostile' },
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
  3: { size: 'xlarge', approx: 'Freighter size became XL' },
  4: { size: 'xlarge' },
};

const CONNECTION_TYPES: Record<number, ConnectionType> = { 0: 'wormhole', 1: 'gate', 2: 'bridge' };
const MASS: Record<number, MassStatus> = { 0: 'fresh', 1: 'reduced', 2: 'critical' };
const BUBBLED: Record<number, Bubbled> = { 0: 'none', 1: 'source', 2: 'target', 3: 'both' };

const HOUR = 3_600_000;
/** Wanderer's time codes 1-3 are marks of a hole near its end: hours left when it was marked. */
const EOL_HOURS_LEFT: Record<number, number> = { 1: 1, 2: 4, 3: 4.5 };

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
    const eveId = signature.eveId.trim().toUpperCase();
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
    const kind = (signature.kind ?? 'cosmic signature').toLowerCase().replace(/[_\s]+/g, ' ');
    if (kind !== 'cosmic signature') {
      report.dropped(
        'signature',
        `${titleCase(kind)} entries`,
        'Darkbeacon keeps cosmic signatures only (anomalies, ships and structures are not scanned sites)',
        name,
      );
      continue;
    }
    if (!SIGNATURE_ID.test(eveId)) {
      report.dropped(
        'signature',
        'Signature without a full id',
        'Darkbeacon needs the whole ABC-123 id',
        name,
      );
      continue;
    }
    const key = `${solarSystemId}:${eveId}`;
    if (sigKeys.has(key)) continue;
    sigKeys.add(key);
    signatures.push(translateSignature(signature, key, solarSystemId, eveId, name, dump.readAt, report));
  }
  linkSignatures(signatures, pairs, wormholeTypes, report, nameOf);
  for (const [key, code] of wormholeTypes) {
    report.dropped(
      'connection',
      'Wormhole type of a connection without a signature',
      'Darkbeacon keeps the wormhole type on the signature, and no signature leads through this connection',
      `${code} ${key}`,
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

/** Notes, then the structures and comments Wanderer kept about the system, as one text. */
function composeDescription(
  system: WandererSystem,
  structures: WandererStructure[],
  comments: WandererComment[],
  report: ReportBuilder,
  name: string,
): string {
  const parts: string[] = [];
  if (system.description) parts.push(system.description.trim());
  if (structures.length > 0) {
    parts.push(['Structures (from Wanderer):', ...structures.map(structureLine)].join('\n'));
    for (let i = 0; i < structures.length; i++)
      report.approximated(
        'structure',
        'Structure kept in the system notes',
        'Darkbeacon has no structure list yet',
        name,
      );
  }
  if (comments.length > 0) {
    const sorted = [...comments].sort((a, b) => (a.insertedAt ?? 0) - (b.insertedAt ?? 0));
    parts.push(
      [
        'Comments (from Wanderer):',
        ...sorted.map((c) => `- ${c.insertedAt ? `${day(c.insertedAt)}: ` : ''}${oneLine(c.text)}`),
      ].join('\n'),
    );
    for (let i = 0; i < comments.length; i++)
      report.approximated(
        'comment',
        'Comment kept in the system notes',
        'Darkbeacon has no comment thread per system',
        name,
      );
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

function structureLine(s: WandererStructure): string {
  const what = [s.type, s.name ? `“${s.name}”` : null].filter(Boolean).join(' ') || 'Structure';
  const owner = s.ownerName
    ? `${s.ownerName}${s.ownerTicker ? ` [${s.ownerTicker}]` : ''}`
    : s.ownerTicker
      ? `[${s.ownerTicker}]`
      : null;
  const state = [s.status, s.endTime ? `until ${moment(s.endTime)}` : null].filter(Boolean).join(' ');
  return `- ${[what, owner, state || null].filter(Boolean).join(' · ')}${s.notes ? ` — ${oneLine(s.notes)}` : ''}`;
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
  else if (size.approx)
    report.approximated('connection', size.approx, 'Darkbeacon has one size above battleships', name);
  const mass = MASS[c.massStatus ?? 0];
  if (!mass)
    report.approximated('connection', `Mass code ${c.massStatus} became Fresh`, 'Unknown mass status', name);

  let timeStatus: TimeStatus = 'normal';
  let eolAt: number | null = null;
  const code = c.timeStatus ?? 0;
  if (EOL_HOURS_LEFT[code] !== undefined) {
    timeStatus = 'eol';
    // Darkbeacon counts EOL as "less than 4 h left from eolAt"; Wanderer marks how much was left.
    const markedAt = updatedAt ?? readAt;
    eolAt = markedAt - (4 - Math.min(4, EOL_HOURS_LEFT[code]!)) * HOUR;
    report.mapped('connection', 'End of life, with the time it was marked', name);
    if (updatedAt === null)
      report.approximated(
        'connection',
        'End of life counted from the import',
        'Wanderer did not say when it was marked',
        name,
      );
  } else if (code >= 4) {
    report.approximated(
      'connection',
      `Lifetime mark "${({ 4: '16 h', 5: '24 h', 6: '48 h' } as Record<number, string>)[code] ?? code}" dropped`,
      "Darkbeacon works a hole's lifetime out from its wormhole type and when it was found",
      name,
    );
  }
  const dangerous = c.dangerous ?? false;
  const bubbled = BUBBLED[c.bubbled ?? 0] ?? 'none';
  if (c.locked)
    report.dropped('connection', 'Lock on a connection', 'Darkbeacon locks systems, not connections', name);
  if (c.customInfo) {
    extra.customInfo = c.customInfo;
    report.dropped(
      'connection',
      'Connection note (custom info)',
      'Darkbeacon connections have no note; it is kept in the import record',
      name,
    );
  }
  if (c.countOfPassage) {
    extra.countOfPassage = c.countOfPassage;
    report.dropped('connection', 'Passage count', 'Darkbeacon records passages per pilot from now on', name);
  }
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
  name: string,
  readAt: number,
  report: ReportBuilder,
): PlannedSignature {
  const extra: Record<string, unknown> = {};
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
  report.mapped('signature', `${titleCase(group ?? 'unknown')} signature`, name);
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

function parseInfo(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return text;
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const moment = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
