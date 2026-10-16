import type { AccessRuleDto, ConnectionDto, MapRole, MapSystemDto, SignatureDto } from '@darkbeacon/shared';
import type { PlannedAccessRule } from './acl.js';
import { mergeFields, type FieldConflict } from './merge.js';
import type { PlannedConnection, PlannedSignature, PlannedSystem } from './translate.js';

export type SystemWrite = Partial<
  Pick<
    MapSystemDto,
    | 'position'
    | 'customName'
    | 'temporaryName'
    | 'status'
    | 'description'
    | 'labelIds'
    | 'systemLabelIds'
    | 'customLabel'
    | 'locked'
    | 'visible'
  >
>;

export type ConnectionWrite = Partial<
  Pick<
    ConnectionDto,
    | 'type'
    | 'timeStatus'
    | 'massStatus'
    | 'shipSize'
    | 'dangerous'
    | 'bubbled'
    | 'eolAt'
    | 'massStatusAt'
    | 'locked'
    | 'note'
    | 'lifetime'
  >
>;

export type SignatureWrite = Partial<
  Pick<SignatureDto, 'group' | 'type' | 'name' | 'description' | 'connectionId' | 'kind' | 'custom'>
>;

/** What to do with one imported object. `written` is what Wanderer has, kept as the next base. */
export interface Decision<W> {
  action: 'create' | 'update' | 'unchanged' | 'skip';
  write: W;
  written: W;
  conflicts: FieldConflict[];
  /** Why it is skipped. */
  reason?: string;
}

const SYSTEM_FIELDS = [
  'position',
  'customName',
  'temporaryName',
  'status',
  'description',
  'labelIds',
  'systemLabelIds',
  'customLabel',
  'locked',
  'visible',
] as const;

/**
 * A system: created as Wanderer has it, or merged field by field (see `mergeFields`). A
 * system locked here keeps its position; hiding a system that is shown here (Wanderer took it off
 * its map) happens only when removals were asked for.
 */
export function decideSystem(
  planned: PlannedSystem,
  here: MapSystemDto | undefined,
  base: SystemWrite | null,
  labelIds: ReadonlyMap<string, string>,
  options: { removeMissing: boolean },
  /** The map's id of each planned Label id (by name); unknown ones are left out. */
  systemLabelIds: ReadonlyMap<string, string> = new Map(),
): Decision<SystemWrite> {
  const wanderer: Required<SystemWrite> = {
    position: planned.fields.position,
    customName: planned.fields.customName,
    temporaryName: planned.fields.temporaryName,
    status: planned.fields.status,
    description: planned.fields.description,
    labelIds: planned.fields.labelKeys.map((k) => labelIds.get(k)).filter((id): id is string => !!id),
    systemLabelIds: planned.fields.systemLabelIds
      .map((id) => systemLabelIds.get(id))
      .filter((id): id is string => !!id),
    customLabel: planned.fields.customLabel,
    locked: planned.fields.locked,
    visible: planned.fields.visible,
  };
  if (!here) return { action: 'create', write: wanderer, written: wanderer, conflicts: [] };
  const protect: Partial<Record<keyof SystemWrite, string>> = {};
  if (here.locked) protect.position = 'The system is locked here';
  if (here.visible && !wanderer.visible && !options.removeMissing)
    protect.visible = 'Wanderer took it off its map; removals were not asked for';
  const { patch, conflicts } = mergeFields<SystemWrite>({
    here: pick(here, SYSTEM_FIELDS),
    wanderer,
    base: base ? { ...wanderer, ...base } : null,
    hereAt: here.updatedAt,
    wandererAt: planned.remoteUpdatedAt,
    fields: SYSTEM_FIELDS,
    joined: ['description', 'labelIds', 'systemLabelIds'],
    protect,
    blank: (field, value) =>
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (field === 'status' && value === 'unknown') ||
      (field === 'locked' && value === false) ||
      // A hidden system here is shown when Wanderer shows it; Wanderer hiding one is a removal.
      (field === 'visible' && value === false),
  });
  return outcome(patch, wanderer, conflicts);
}

const CONNECTION_FIELDS = [
  'type',
  'timeStatus',
  'massStatus',
  'shipSize',
  'dangerous',
  'bubbled',
  'locked',
  'note',
  'lifetime',
] as const;

/**
 * A connection: created with Wanderer's states and times, or merged. Default states (normal,
 * fresh, not dangerous, no bubble) count as blank, so Wanderer marking a hole EOL or critical
 * fills them in, but Wanderer's default never clears a mark made here (unless Wanderer changed
 * it since the last import and this side did not).
 */
export function decideConnection(
  planned: PlannedConnection,
  here: ConnectionDto | undefined,
  base: ConnectionWrite | null,
): Decision<ConnectionWrite> {
  const wanderer: Required<ConnectionWrite> = { ...planned.fields };
  if (!here) return { action: 'create', write: wanderer, written: wanderer, conflicts: [] };
  const { patch, conflicts } = mergeFields<ConnectionWrite>({
    // Fields a connection here may lack read as their defaults.
    here: {
      ...pick(here, CONNECTION_FIELDS),
      locked: here.locked ?? false,
      note: here.note ?? '',
      lifetime: here.lifetime ?? null,
    },
    wanderer,
    base: base ? { ...wanderer, ...base } : null,
    hereAt: here.updatedAt,
    wandererAt: planned.remoteUpdatedAt,
    fields: CONNECTION_FIELDS,
    joined: ['note'],
    blank: (field, value) =>
      (field === 'timeStatus' && value === 'normal') ||
      (field === 'massStatus' && value === 'fresh') ||
      (field === 'dangerous' && value === false) ||
      (field === 'bubbled' && value === 'none') ||
      (field === 'locked' && value === false) ||
      (field === 'note' && value === '') ||
      (field === 'lifetime' && value === null),
  });
  if (patch.timeStatus === 'eol') patch.eolAt = wanderer.eolAt;
  if (patch.timeStatus === 'normal') patch.eolAt = null;
  if (patch.massStatus !== undefined) patch.massStatusAt = wanderer.massStatusAt;
  return outcome(patch, wanderer, conflicts);
}

const SIGNATURE_FIELDS = ['group', 'type', 'name', 'description', 'connectionId', 'kind', 'custom'] as const;

/** A signature: created, or merged (notes joined, a link here never cut by Wanderer). */
export function decideSignature(
  planned: PlannedSignature,
  here: SignatureDto | undefined,
  base: SignatureWrite | null,
  connectionId: string | null,
): Decision<SignatureWrite> {
  const wanderer: Required<SignatureWrite> = { ...planned.fields, connectionId };
  if (!here) return { action: 'create', write: wanderer, written: wanderer, conflicts: [] };
  const { patch, conflicts } = mergeFields<SignatureWrite>({
    here: { ...pick(here, SIGNATURE_FIELDS), kind: here.kind ?? 'signature', custom: here.custom ?? false },
    wanderer,
    base: base ? { ...wanderer, ...base } : null,
    hereAt: here.updatedAt,
    wandererAt: planned.remoteUpdatedAt,
    fields: SIGNATURE_FIELDS,
    joined: ['description'],
    protect: here.connectionId ? { connectionId: 'Linked here' } : {},
    blank: (field, value) =>
      value === null ||
      value === '' ||
      (field === 'group' && value === 'unknown') ||
      (field === 'custom' && value === false),
  });
  // A link makes it a wormhole; the use case does the same.
  if (patch.connectionId) delete patch.group;
  return outcome(patch, wanderer, conflicts);
}

/** A signature deleted on the map: when, and whether the sweeper let it expire. */
export interface SignatureTombstone {
  deletedAt: number;
  /**
   * Present when the sweeper let it expire (lazy delete, retention) instead of someone deleting
   * it: when it was last seen or changed, which the expiry counted from (null: not known).
   */
  expiredFrom?: number | null;
}

/**
 * Whether a signature Wanderer still has stays deleted on the map:
 * - deleted on purpose (by someone, a paste's "remove missing", an earlier removal of an import):
 *   while Wanderer has not changed it since the deletion; one Wanderer changed since (scanned
 *   again, edited) comes back, one whose change time Wanderer did not give stays deleted;
 * - expired by the sweeper: only while Wanderer has not seen it since the moment the expiry
 *   counted from (`seenAt`: Wanderer's own `updated_at`, null when it gave none). A signature
 *   Wanderer saw later comes back with Wanderer's times, and the sweeper judges it again; one it
 *   did not see since stays out, so the two do not take turns removing and adding it.
 */
export function removedHere(
  planned: Pick<PlannedSignature, 'key' | 'remoteUpdatedAt'> & { seenAt?: number | null },
  here: ReadonlyMap<string, unknown>,
  tombstones: ReadonlyMap<string, SignatureTombstone>,
): boolean {
  if (here.has(planned.key)) return false;
  const tombstone = tombstones.get(planned.key);
  if (tombstone === undefined) return false;
  if (tombstone.expiredFrom !== undefined) {
    const seenAt = planned.seenAt ?? null;
    if (seenAt === null) return true;
    return tombstone.expiredFrom !== null && seenAt <= tombstone.expiredFrom;
  }
  return planned.remoteUpdatedAt === null || planned.remoteUpdatedAt <= tombstone.deletedAt;
}

/**
 * An access rule: added when the map has none for the subject. One the import added before and
 * nobody changed since follows Wanderer's role; any other rule here is kept.
 */
export function decideAccess(
  planned: PlannedAccessRule,
  here: AccessRuleDto | undefined,
  base: { role: MapRole; ruleId: string } | null,
): { action: 'create' | 'replace' | 'unchanged'; conflict: FieldConflict | null } {
  if (!here) return { action: 'create', conflict: null };
  if (here.role === planned.role) return { action: 'unchanged', conflict: null };
  if (base && base.ruleId === here.id && base.role === here.role)
    return { action: 'replace', conflict: null };
  return {
    action: 'unchanged',
    conflict: {
      field: 'role',
      here: here.role,
      wanderer: planned.role,
      keeps: 'here',
      why: 'The map has its own rule for them',
    },
  };
}

function outcome<W>(patch: Partial<W>, wanderer: W, conflicts: FieldConflict[]): Decision<W> {
  const changed = Object.keys(patch).length > 0;
  return { action: changed ? 'update' : 'unchanged', write: patch as W, written: wanderer, conflicts };
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = value[key];
  return out;
}
