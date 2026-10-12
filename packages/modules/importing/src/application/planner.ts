import type {
  AccessRuleDto,
  ConnectionDto,
  ImportConflictDto,
  ImportOutcomeDto,
  LabelDto,
  MapRole,
  MapSystemDto,
  SignatureDto,
} from '@darkbeacon/shared';
import {
  decideAccess,
  decideConnection,
  decideSignature,
  decideSystem,
  type ConnectionWrite,
  type SignatureWrite,
  type SystemWrite,
} from '../domain/decide.js';
import type { FieldConflict } from '../domain/merge.js';
import { pairKey, type ImportPlan } from '../domain/translate.js';
import type { ImportLinkRecord } from '../ports/repositories.js';

/** The kinds an import reports on, in the order it writes them. */
export const KINDS = ['labels', 'systems', 'connections', 'signatures', 'access', 'settings'] as const;
export type ImportKind = (typeof KINDS)[number];

export function emptyOutcome(): ImportOutcomeDto {
  return { created: 0, updated: 0, unchanged: 0, skipped: 0, removed: 0 };
}

export function emptyOutcomes(): Record<string, ImportOutcomeDto> {
  return Object.fromEntries(KINDS.map((k) => [k, emptyOutcome()]));
}

/** What an import writes into: the map as it is now. */
export interface TargetState {
  labels: LabelDto[];
  systems: MapSystemDto[];
  connections: ConnectionDto[];
  signatures: SignatureDto[];
  /** Null when the caller may not see or change access rules. */
  rules: AccessRuleDto[] | null;
}

/** Links of one map and source, by kind and external id. */
export class LinkIndex {
  private readonly byKey = new Map<string, ImportLinkRecord>();

  constructor(links: readonly ImportLinkRecord[]) {
    for (const link of links) this.byKey.set(`${link.kind}\u0000${link.externalId}`, link);
  }

  get(kind: string, externalId: string): ImportLinkRecord | undefined {
    return this.byKey.get(`${kind}\u0000${externalId}`);
  }

  all(kind: string): ImportLinkRecord[] {
    return [...this.byKey.values()].filter((l) => l.kind === kind);
  }
}

/** Label plan keys -> label ids on the map (by name, without case). */
export function labelIdsFor(plan: ImportPlan, labels: readonly LabelDto[]): Map<string, string> {
  const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  const out = new Map<string, string>();
  for (const label of plan.labels) {
    const id = byName.get(label.name.toLowerCase());
    out.set(label.key, id ?? `new:${label.key}`);
  }
  return out;
}

export interface Assessment {
  outcome: Record<string, ImportOutcomeDto>;
  conflicts: ImportConflictDto[];
}

/**
 * What writing `plan` into the map as it is now would do, without writing anything: the same
 * decisions the job makes, counted, with every field the two sides disagree on.
 */
export function assess(
  plan: ImportPlan,
  state: TargetState,
  links: LinkIndex,
  options: { removeMissing: boolean; includeAccess: boolean },
): Assessment {
  const outcome = emptyOutcomes();
  const conflicts: ImportConflictDto[] = [];
  const labelIds = labelIdsFor(plan, state.labels);
  const labelName = (id: string) =>
    state.labels.find((l) => l.id === id)?.name ??
    plan.labels.find((l) => `new:${l.key}` === id)?.name ??
    'a label';

  const known = new Set(state.labels.map((l) => l.name.toLowerCase()));
  for (const label of plan.labels)
    outcome.labels![known.has(label.name.toLowerCase()) ? 'unchanged' : 'created']++;

  const systems = new Map(state.systems.map((s) => [s.solarSystemId, s]));
  const visibleAfter = new Set(state.systems.filter((s) => s.visible).map((s) => s.solarSystemId));
  for (const planned of plan.systems) {
    const base = links.get('system', planned.key)?.written as SystemWrite | undefined;
    const decision = decideSystem(
      planned,
      systems.get(planned.solarSystemId),
      base ?? null,
      labelIds,
      options,
    );
    count(outcome.systems!, decision.action);
    const after = { ...systems.get(planned.solarSystemId), ...decision.write } as MapSystemDto;
    if (after.visible) visibleAfter.add(planned.solarSystemId);
    else visibleAfter.delete(planned.solarSystemId);
    for (const c of decision.conflicts) conflicts.push(conflict('system', planned.name, c, labelName));
  }

  const connections = new Map(state.connections.map((c) => [pairKey(c.source, c.target), c]));
  const linkedPairs = new Set(connections.keys());
  for (const planned of plan.connections) {
    if (!visibleAfter.has(planned.source) || !visibleAfter.has(planned.target)) {
      outcome.connections!.skipped++;
      continue;
    }
    const base = links.get('connection', planned.key)?.written as ConnectionWrite | undefined;
    const decision = decideConnection(planned, connections.get(planned.key), base ?? null);
    count(outcome.connections!, decision.action);
    linkedPairs.add(planned.key);
    for (const c of decision.conflicts) conflicts.push(conflict('connection', planned.name, c, labelName));
  }

  const signatures = new Map(state.signatures.map((s) => [`${s.solarSystemId}:${s.eveId}`, s]));
  for (const planned of plan.signatures) {
    if (
      !systems.has(planned.solarSystemId) &&
      !plan.systems.some((s) => s.solarSystemId === planned.solarSystemId)
    ) {
      outcome.signatures!.skipped++;
      continue;
    }
    const linked =
      planned.linkedTo !== null && linkedPairs.has(pairKey(planned.solarSystemId, planned.linkedTo));
    const connectionId = linked
      ? (connections.get(pairKey(planned.solarSystemId, planned.linkedTo!))?.id ?? 'new')
      : null;
    const base = links.get('signature', planned.key)?.written as SignatureWrite | undefined;
    const decision = decideSignature(planned, signatures.get(planned.key), base ?? null, connectionId);
    count(outcome.signatures!, decision.action);
    for (const c of decision.conflicts) conflicts.push(conflict('signature', planned.name, c, labelName));
  }

  if (options.includeAccess && state.rules) {
    const rules = new Map(state.rules.map((r) => [`${r.subjectKind}:${r.subjectId}`, r]));
    for (const planned of plan.access) {
      const link = links.get('access', planned.key);
      const base = link ? { role: (link.written as { role: MapRole }).role, ruleId: link.localId } : null;
      const decision = decideAccess(planned, rules.get(planned.key), base);
      if (decision.action === 'create') outcome.access!.created++;
      else if (decision.action === 'replace') outcome.access!.updated++;
      else outcome.access!.unchanged++;
      if (decision.conflict)
        conflicts.push(conflict('access', planned.wandererName ?? planned.key, decision.conflict, labelName));
    }
  } else outcome.access!.skipped += plan.access.length;

  if (options.removeMissing) {
    const plannedKeys = {
      system: new Set(plan.systems.map((s) => s.key)),
      connection: new Set(plan.connections.map((c) => c.key)),
      signature: new Set(plan.signatures.map((s) => s.key)),
    };
    for (const kind of ['system', 'connection', 'signature'] as const) {
      for (const link of links.all(kind))
        if (!plannedKeys[kind].has(link.externalId)) outcome[`${kind}s`]!.removed++;
    }
  }
  return { outcome, conflicts };
}

function count(outcome: ImportOutcomeDto, action: 'create' | 'update' | 'unchanged' | 'skip'): void {
  if (action === 'create') outcome.created++;
  else if (action === 'update') outcome.updated++;
  else if (action === 'skip') outcome.skipped++;
  else outcome.unchanged++;
}

const FIELD_NAMES: Record<string, string> = {
  position: 'Position',
  customName: 'Name',
  temporaryName: 'Temporary name',
  tag: 'Tag',
  status: 'Status',
  description: 'Notes',
  labelIds: 'Labels',
  locked: 'Locked',
  visible: 'On the map',
  type: 'Type',
  timeStatus: 'Lifetime',
  massStatus: 'Mass',
  shipSize: 'Ship size',
  dangerous: 'Dangerous',
  bubbled: 'Bubbled',
  group: 'Group',
  name: 'Name',
  connectionId: 'Linked connection',
  role: 'Role',
};

export function conflict(
  kind: ImportConflictDto['kind'],
  name: string,
  c: FieldConflict,
  labelName: (id: string) => string,
): ImportConflictDto {
  return {
    kind,
    name,
    field: FIELD_NAMES[c.field] ?? c.field,
    here: display(c.field, c.here, labelName),
    wanderer: display(c.field, c.wanderer, labelName),
    keeps: c.keeps,
    why: c.why,
  };
}

function display(field: string, value: unknown, labelName: (id: string) => string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'position' && typeof value === 'object') {
    const p = value as { x: number; y: number };
    return `${Math.round(p.x)}, ${Math.round(p.y)}`;
  }
  if (field === 'labelIds' && Array.isArray(value))
    return value.map((id) => labelName(String(id))).join(', ') || '—';
  if (field === 'connectionId') return 'linked';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
