import {
  COMMENT_MAX_LENGTH,
  MAP_DESCRIPTION_MAX,
  TIMED_STRUCTURE_STATUSES,
  type Bubbled,
  type ConnectionType,
  type ImportCountsDto,
  type ImportReportLineDto,
  type MapScope,
  type LifetimeMark,
  type MassStatus,
  type Position,
  type ShipSize,
  type SignatureGroup,
  type SignatureKind,
  type StructureStatus,
  type SystemStatus,
  type TimeStatus,
} from '@darkbeacon/shared';
import { planAccess, type PlannedAccessRule } from './acl.js';
import { spreadLayout } from './layout.js';
import { ReportBuilder } from './report.js';
import { planWebhooks, type PlannedWebhook } from './webhooks.js';
import type { WandererConnection, WandererMapDump, WandererSignature, WandererSystem } from './wanderer.js';

// ---- the plan: Darkbeacon-shaped data, keyed by stable external ids ------------------------------

/**
 * System attributes as Darkbeacon keeps them. Tags by their plan key and Labels by their Wanderer id
 * until the map has ids. Darkbeacon's own free-text `tag` is never written.
 */
export interface SystemFields {
  position: Position;
  customName: string | null;
  temporaryName: string | null;
  status: SystemStatus;
  description: string;
  locked: boolean;
  visible: boolean;
  /** Tags (`MapSystemDto.labelIds`): Wanderer's tag and the statuses Darkbeacon has no value for. */
  labelKeys: string[];
  /** Labels (`MapSystemDto.systemLabelIds`), as ids of `ImportPlan.systemLabels`. */
  systemLabelIds: string[];
  customLabel: string | null;
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

/** One of the map's Labels (WH1, A, B...), with Wanderer's id. */
export interface PlannedSystemLabel {
  id: string;
  name: string;
  description: string;
}

/** A Tag (`MapDto.labels`): a coloured marker of the map. */
export interface PlannedLabel {
  /** `tag:<name in lower case>`. */
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

/** Who wrote a comment or added a structure in Wanderer. */
export interface PlannedAuthor {
  characterId: number | null;
  name: string;
}

/** A comment on a system, as Wanderer kept it (who and when included). */
export interface PlannedComment {
  /** Wanderer's id, or `<system>:<time>:<text hash>` for sources without one. */
  key: string;
  solarSystemId: number;
  /** For reports: the system's name. */
  name: string;
  text: string;
  author: PlannedAuthor | null;
  createdAt: number | null;
}

export interface StructureFields {
  typeId: number | null;
  typeName: string;
  name: string;
  owner: { id: number | null; name: string; ticker: string | null } | null;
  status: StructureStatus;
  endsAt: number | null;
  notes: string;
}

/** A structure in a system, with its owner and timer. */
export interface PlannedStructure {
  /** Wanderer's id, or `<system>:<type>:<name>` for sources without one. */
  key: string;
  solarSystemId: number;
  name: string;
  fields: StructureFields;
  author: PlannedAuthor | null;
  createdAt: number | null;
  remoteUpdatedAt: number | null;
}

export interface ImportPlan {
  mapName: string;
  mapSlug: string | null;
  /** Tags the systems use (created in the map's Tags when missing). */
  labels: PlannedLabel[];
  /** The map's Labels in Wanderer's order (its defaults A, B, C, 1, 2, 3 when it has none). */
  systemLabels: PlannedSystemLabel[];
  systems: PlannedSystem[];
  connections: PlannedConnection[];
  signatures: PlannedSignature[];
  passages: PlannedPassage[];
  /** Comments and structures, as Darkbeacon comments and structures (not notes). */
  comments: PlannedComment[];
  structures: PlannedStructure[];
  access: PlannedAccessRule[];
  hubs: number[];
  /** Auto-mapping scopes from the Wanderer map scope; null when unknown. */
  scopes: MapScope[] | null;
  /** The map's description; null when Wanderer has none. */
  description: string | null;
  /** Webhook subscriptions, added switched off. */
  webhooks: PlannedWebhook[];
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

/**
 * Wanderer system status codes as its map stores them (the frontend's `STATUSES`, which is what
 * people set): 0 unknown ("Clear"), 1 home, 2 friendly, 3 looking for, 4 warning, 5 target,
 * 6 dangerous. Wanderer's API docs and a comment in its resource list another numbering
 * (targetPrimary, targetSecondary...) that the app never writes.
 */
const STATUS_NAMES = ['unknown', 'home', 'friendly', 'lookingFor', 'warning', 'target', 'dangerous'] as const;

const STATUS: Record<string, { status: SystemStatus; label?: string; approx?: string }> = {
  unknown: { status: 'unknown' },
  clear: { status: 'unknown' },
  home: { status: 'home' },
  friendly: { status: 'friendly' },
  lookingfor: { status: 'unknown', label: 'Looking for', approx: 'Looking for became a Tag' },
  warning: { status: 'warning' },
  target: { status: 'target' },
  dangerous: { status: 'hostile' },
  hostile: { status: 'hostile' },
};

/** Tag colours for the statuses Darkbeacon has no value for. */
const STATUS_TAG_COLORS: Record<string, string> = { 'Looking for': '#3b82f6' };
/** Wanderer's tag becomes a neutral grey Tag. */
const NEUTRAL_TAG = '#6b7280';

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

/** One of the scopes of a Wanderer that keeps several. */
const SCOPE_ITEMS: Record<string, MapScope> = {
  wormholes: 'wormhole',
  hi: 'high',
  high: 'high',
  low: 'low',
  null: 'null',
  pochven: 'pochven',
};

/** Auto-mapping scopes from Wanderer's `scopes` (when it has them) or its single `scope`. */
function mapScopes(map: WandererMapDump['map'], report: ReportBuilder): MapScope[] | null {
  if (map.scopes && map.scopes.length > 0) {
    const out: MapScope[] = [];
    for (const item of map.scopes) {
      const scope = SCOPE_ITEMS[item.toLowerCase()];
      if (scope) out.push(scope);
      else report.dropped('setting', `Map scope "${item}"`, 'Darkbeacon has no equivalent');
    }
    report.mapped('setting', 'Auto-mapping scopes');
    return [...new Set(out)];
  }
  const scopes = map.scope ? (SCOPES[map.scope.toLowerCase()] ?? null) : null;
  if (map.scope && !scopes)
    report.dropped('setting', `Map scope "${map.scope}"`, 'Darkbeacon has no equivalent');
  else if (scopes) report.mapped('setting', 'Auto-mapping scope');
  return scopes;
}

const LIMITS = {
  connectionNote: 2000,
  customName: 64,
  temporaryName: 64,
  description: 10_000,
  sigName: 128,
  sigType: 64,
  sigDescription: 2000,
  label: 32,
  systemLabel: 8,
  systemLabelDescription: 120,
  customLabel: 16,
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
  const labels = new TagSet();
  const systemLabels = new SystemLabelSet(dump, report);
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
    if (system.tag) {
      labelKeys.push(labels.add(system.tag, NEUTRAL_TAG));
      report.approximated('system', 'Tag became a Darkbeacon Tag', 'Tags are the map’s markers', name);
    }
    if (status.label)
      labelKeys.push(labels.add(status.label, STATUS_TAG_COLORS[status.label] ?? NEUTRAL_TAG));
    const systemLabelIds: string[] = [];
    for (const id of system.labels.ids) {
      const known = systemLabels.idFor(id);
      if (known) systemLabelIds.push(known);
      else
        report.dropped('system', 'Label the map does not list', 'Wanderer had no label with that id', name);
    }
    const customLabel = cut(system.labels.custom, LIMITS.customLabel, 'system', 'Custom label', report, name);

    let position = positions.get(system.solarSystemId);
    if (!position) {
      position = { x: 0, y: 360 * 3 + unplaced++ * 150 };
      report.approximated('system', 'No position', 'Placed below the chain', name);
    }
    const description = cut(system.description, LIMITS.description, 'system', 'Notes', report, name) ?? '';
    // Wanderer's own name of the system, where the source gives it raw: another name than the
    // real one is the name someone gave it, and wins over `custom_name` as in Wanderer.
    const renamed =
      system.rawName && system.rawName !== name && system.rawName !== String(system.solarSystemId)
        ? system.rawName
        : null;
    const fields: SystemFields = {
      position,
      customName: cut(renamed ?? system.customName, LIMITS.customName, 'system', 'Name', report, name),
      temporaryName: cut(
        system.temporaryName,
        LIMITS.temporaryName,
        'system',
        'Temporary name',
        report,
        name,
      ),
      status: status.status,
      description,
      locked: system.locked,
      visible: system.visible,
      labelKeys: [...new Set(labelKeys)].slice(0, 16),
      systemLabelIds: [...new Set(systemLabelIds)].slice(0, 32),
      customLabel: customLabel?.trim() || null,
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

  // Structures and comments -----------------------------------------------------------------------
  const authorOf = (eveId: string | null, knownName: string | null): PlannedAuthor | null => {
    const characterId = eveId && /^\d+$/.test(eveId) ? Number(eveId) : null;
    const name = knownName ?? (eveId ? (context.characterName?.(eveId) ?? null) : null);
    return name || characterId ? { characterId, name: name ?? `Character ${eveId}` } : null;
  };
  const plannedStructures: PlannedStructure[] = [];
  const structureKeys = new Set<string>();
  for (const s of dump.structures) {
    const id = s.solarSystemId ?? (s.systemUuid ? systemsByUuid.get(s.systemUuid) : undefined);
    if (!id || !onMap.has(id)) {
      report.dropped(
        'structure',
        'Structure of a system that is not imported',
        'Its system is not on the map',
        s.name ?? undefined,
      );
      continue;
    }
    const systemName = nameOf(id);
    const typeName = s.type?.trim() || 'Structure';
    const structureName = cut(s.name, 100, 'structure', 'Name', report, systemName) ?? typeName;
    const key = s.id ?? `${id}:${s.typeId ?? typeName}:${structureName}`;
    if (structureKeys.has(key)) continue;
    structureKeys.add(key);
    const status = structureStatus(s.status, report, systemName);
    const owner =
      s.ownerName || s.ownerTicker
        ? {
            id: s.ownerId,
            name: (s.ownerName ?? s.ownerTicker ?? '').slice(0, 100),
            ticker: s.ownerTicker?.slice(0, 10) ?? null,
          }
        : null;
    if (s.endTime && !TIMED_STRUCTURE_STATUSES.includes(status))
      report.dropped(
        'structure',
        'Timer of a structure that is not anchoring or reinforced',
        'Only those run against a timer',
        systemName,
      );
    plannedStructures.push({
      key,
      solarSystemId: id,
      name: systemName,
      fields: {
        typeId: s.typeId && /^\d+$/.test(s.typeId) ? Number(s.typeId) : null,
        typeName: typeName.slice(0, 100),
        name: structureName,
        owner,
        status,
        endsAt: TIMED_STRUCTURE_STATUSES.includes(status) ? s.endTime : null,
        notes: cut(s.notes, 2000, 'structure', 'Notes', report, systemName) ?? '',
      },
      author: authorOf(s.characterEveId, null),
      createdAt: s.insertedAt ?? s.updatedAt,
      remoteUpdatedAt: s.updatedAt ?? dump.readAt,
    });
    report.mapped('structure', 'Structure, with its owner and timer', systemName);
  }
  const plannedComments: PlannedComment[] = [];
  const commentKeys = new Set<string>();
  for (const c of dump.comments) {
    const id = c.solarSystemId ?? (c.systemUuid ? systemsByUuid.get(c.systemUuid) : undefined);
    if (!id || !onMap.has(id)) {
      report.dropped('comment', 'Comment on a system that is not imported', 'Its system is not on the map');
      continue;
    }
    const systemName = nameOf(id);
    const text = cut(c.text, COMMENT_MAX_LENGTH, 'comment', 'Comment', report, systemName);
    if (!text) continue;
    const key = c.id ?? `${id}:${c.insertedAt ?? 0}:${hashText(c.text)}`;
    if (commentKeys.has(key)) continue;
    commentKeys.add(key);
    plannedComments.push({
      key,
      solarSystemId: id,
      name: systemName,
      text,
      author: authorOf(c.authorEveId, c.authorName),
      createdAt: c.insertedAt,
    });
    report.mapped('comment', 'Comment, with who wrote it and when', systemName);
  }

  // Access, settings ---------------------------------------------------------------------------
  const access = planAccess(dump.acls, report);
  const hubs = [...new Set(dump.hubs)].filter((id) => context.systemName(id) !== null);
  if (hubs.length > 20) {
    report.dropped('setting', 'Hubs beyond the first 20', 'A Darkbeacon map has at most 20 hubs');
    hubs.length = 20;
  }
  if (hubs.length > 0) report.mapped('setting', `Map hubs (${hubs.length})`);
  const scopes = mapScopes(dump.map, report);
  let description = dump.map.description?.trim() || null;
  if (description && description.length > MAP_DESCRIPTION_MAX) {
    report.approximated('setting', 'Map description', `Shortened to ${MAP_DESCRIPTION_MAX} characters`);
    description = `${description.slice(0, MAP_DESCRIPTION_MAX - 1)}…`;
  } else if (description) report.mapped('setting', 'Map description');
  const webhooks = planWebhooks(dump.webhooks ?? [], report);
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
    systemLabels: systemLabels.list(),
    systems,
    connections,
    signatures,
    passages,
    comments: plannedComments,
    structures: plannedStructures,
    access,
    hubs,
    scopes,
    description,
    webhooks,
    layoutScale: layout.scale,
  };
  const counts: ImportCountsDto = {
    systems: systems.filter((s) => s.fields.visible).length,
    hiddenSystems: systems.filter((s) => !s.fields.visible).length,
    connections: connections.length,
    signatures: signatures.length,
    passages: passages.length,
    structures: plannedStructures.length,
    comments: plannedComments.length,
    labels: plan.systemLabels.length,
    tags: plan.labels.length,
    accessRules: access.length,
    hubs: hubs.length,
    webhooks: webhooks.length,
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
      massStatusAt: (mass ?? 'fresh') !== 'fresh' ? (c.massStatusAt ?? updatedAt ?? readAt) : null,
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

/** Tags by name (any case): one Tag per name, whatever Wanderer tag or status it came from. */
class TagSet {
  private readonly byKey = new Map<string, PlannedLabel>();

  add(name: string, color: string): string {
    const trimmed = name.trim().slice(0, LIMITS.label);
    const key = `tag:${trimmed.toLowerCase()}`;
    if (!this.byKey.has(key)) this.byKey.set(key, { key, name: trimmed, color, description: '' });
    return key;
  }

  list(): PlannedLabel[] {
    return [...this.byKey.values()];
  }
}

/**
 * The map's Labels as Wanderer lists them (its defaults A, B, C, 1, 2, 3 when the map has none):
 * ids kept, names cut to 8 characters, descriptions to 120, colours dropped, a later label with the
 * name of an earlier one (any case) merged into it.
 */
class SystemLabelSet {
  private readonly list_: PlannedSystemLabel[] = [];
  private readonly ids = new Map<string, string>();

  constructor(dump: WandererMapDump, report: ReportBuilder) {
    const own: Array<{ id: string; name: string; description: string | null }> =
      dump.systemLabels && dump.systemLabels.length > 0
        ? dump.systemLabels
        : Object.entries(dump.labelNames ?? {}).map(([id, name]) => ({ id, name, description: null }));
    // Without the map's own list its names are unknown: rather than guessing Wanderer's defaults
    // (a map may have renamed every one), each label the systems use is named after its id.
    const used = [...new Set(dump.systems.flatMap((s) => s.labels.ids.map(normalLabelId)))].filter(Boolean);
    const source =
      own.length > 0 ? own : used.map((id) => ({ id, name: id, description: null as string | null }));
    if (own.length === 0 && used.length > 0)
      report.approximated(
        'label',
        'Labels named after their Wanderer ids',
        'This source did not give the map’s label names; the map export or Wanderer’s database has them',
        used.join(', '),
      );
    for (const label of source) {
      const id = normalLabelId(label.id);
      const name = label.name.trim().slice(0, LIMITS.systemLabel);
      if (!name) continue;
      if (label.name.trim().length > LIMITS.systemLabel)
        report.approximated('label', 'Label name', `Shortened to ${LIMITS.systemLabel} characters`, name);
      const same = this.list_.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (same) {
        this.ids.set(id, same.id);
        report.approximated('label', 'Label with the name of another', 'Merged into the first', name);
        continue;
      }
      if (this.ids.has(id)) continue;
      this.ids.set(id, id);
      this.list_.push({
        id,
        name,
        description: (label.description ?? '').trim().slice(0, LIMITS.systemLabelDescription),
      });
      if (own.length > 0) report.mapped('label', 'Label', name);
    }
  }

  /** The plan's id of a Wanderer label id, or null when the map does not list it. */
  idFor(wandererId: string): string | null {
    return this.ids.get(normalLabelId(wandererId)) ?? null;
  }

  list(): PlannedSystemLabel[] {
    return this.list_;
  }
}

/** Older Wanderer versions prefix the default ids (`la`, `l1`). */
function normalLabelId(id: string): string {
  return /^l[abc123]$/.test(id) ? id.slice(1) : id;
}

const STRUCTURE_STATUSES: Record<string, StructureStatus> = {
  powered: 'powered',
  online: 'powered',
  anchoring: 'anchoring',
  unanchoring: 'unanchoring',
  lowpower: 'lowPower',
  abandoned: 'abandoned',
  reinforced: 'reinforced',
};

function structureStatus(value: string | null, report: ReportBuilder, name: string): StructureStatus {
  if (!value) return 'powered';
  const found = STRUCTURE_STATUSES[value.toLowerCase().replace(/[\s_-]+/g, '')];
  if (found) return found;
  report.approximated('structure', `Status "${value}" became Powered`, 'Darkbeacon has no such status', name);
  return 'powered';
}

/** A short stable hash of a text, for keys of rows the source gives no id. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
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
