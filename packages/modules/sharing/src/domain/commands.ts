import { ForbiddenError } from '@darkbeacon/core';
import type {
  ChainObjectKind,
  ConnectionType,
  PasteSignaturesRequest,
  Position,
  ShareScope,
  UpdateConnectionRequest,
  UpdateSignatureRequest,
  UpdateSystemRequest,
} from '@darkbeacon/shared';
import { connectionGroupOf } from './keys.js';
import { FIELD_SCOPES, fieldAllowed, type FieldScope } from './scopes.js';

/**
 * A change written back to a source through its ChainSource, by stable keys and wire field names
 * (see `FIELD_SCOPES`), so a source on another instance could take (or refuse) it the same way.
 */
export type ChainCommand =
  | { op: 'system.add'; key: string; near?: string; hint?: Position }
  | { op: 'system.update'; key: string; fields: Record<string, unknown> }
  | { op: 'system.remove'; key: string }
  | { op: 'connection.add'; key: string; kind?: ConnectionType }
  | { op: 'connection.update'; key: string; fields: Record<string, unknown> }
  | { op: 'connection.remove'; key: string }
  | { op: 'signature.add'; system: string; code: string; fields: Record<string, unknown> }
  | { op: 'signature.update'; key: string; fields: Record<string, unknown> }
  | { op: 'signature.remove'; key: string }
  | { op: 'signatures.paste'; system: string; text: string; mode: PasteSignaturesRequest['mode'] };

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, unknown>;

/**
 * A system patch in wire fields; `position` is the merged map's own layout and never written back.
 * Labels cross by name (`labelNames` turns the merged map's label ids into its names); without it
 * a change of Labels is left out.
 */
export function systemFields(
  request: UpdateSystemRequest,
  labelNames?: (ids: readonly string[]) => string[],
): Record<string, unknown> {
  return defined({
    status: request.status,
    tag: request.tag,
    customName: request.customName,
    notes: request.description,
    label: request.temporaryName,
    systemLabels: request.systemLabelIds && labelNames ? labelNames(request.systemLabelIds) : undefined,
    customLabel: request.customLabel,
    labelIds: request.labelIds,
    locked: request.locked,
  });
}

/** Ids of `list` named by `names` (any case), in the list's order; unknown names drop out. */
export function labelIdsByName(
  names: readonly unknown[],
  list: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const wanted = new Set(names.filter((n): n is string => typeof n === 'string').map((n) => n.toLowerCase()));
  return list.filter((l) => wanted.has(l.name.toLowerCase())).map((l) => l.id);
}

/** Names of the labels `ids` names, in the list's order. */
export function labelNamesById(
  ids: readonly string[],
  list: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const on = new Set(ids);
  return list.filter((l) => on.has(l.id)).map((l) => l.name);
}

/**
 * A connection patch in wire fields. `bubbled` is said relative to the merged connection, which is
 * drawn from the lower system id (`source`) to the higher (`target`).
 */
export function connectionFields(request: UpdateConnectionRequest): Record<string, unknown> {
  const bubbled =
    request.bubbled === undefined
      ? undefined
      : ({ none: 'none', source: 'low', target: 'high', both: 'both' } as const)[request.bubbled];
  return defined({
    kind: request.type,
    time: request.timeStatus === undefined ? undefined : { status: request.timeStatus },
    mass: request.massStatus === undefined ? undefined : { status: request.massStatus },
    size: request.shipSize,
    massSaved: request.massSaved,
    dangerous: request.dangerous,
    bubbled,
    note: request.note,
    locked: request.locked,
    lifetime:
      request.lifetime === undefined
        ? undefined
        : request.lifetime === null
          ? null
          : { mark: request.lifetime },
  });
}

/** A signature patch in wire fields; a link names the pair of the merged connection. */
export function signatureFields(request: UpdateSignatureRequest): Record<string, unknown> {
  let link: string | null | undefined;
  if (request.connectionId === null) link = null;
  else if (request.connectionId !== undefined) {
    const group = connectionGroupOf(request.connectionId);
    if (!group) throw new ForbiddenError('Unknown connection');
    link = group.pair;
  }
  return defined({
    code: request.eveId,
    group: request.group,
    type: request.type,
    name: request.name,
    notes: request.description,
    kind: request.kind,
    link,
  });
}

/** A signature code change is part of the signature itself. */
const SIGNATURE_IDENTITY = new Set(['code']);

/**
 * The fields of a patch a source with `scopes` may take: a field outside them cannot be written
 * (what a map cannot read it cannot change). Returns the fields it may not take.
 */
export function refusedFields(
  kind: ChainObjectKind,
  fields: Record<string, unknown>,
  scopes: readonly ShareScope[] | 'all',
): string[] {
  return Object.keys(fields).filter((name) => {
    if (kind === 'signature' && SIGNATURE_IDENTITY.has(name))
      return !fieldAllowed('signature', 'group', scopes);
    return !fieldAllowed(kind, name, scopes);
  });
}

/** Human words for the scope a field needs, for refusals. */
export function scopeOfField(kind: ChainObjectKind, field: string): FieldScope | null {
  if (kind === 'signature' && SIGNATURE_IDENTITY.has(field)) return 'signatures';
  return FIELD_SCOPES[kind][field] ?? null;
}

export const SCOPE_WORDS: Record<FieldScope, string> = {
  topology: 'systems and connections',
  connectionStatus: 'connection status',
  signatures: 'signatures',
  intel: 'system intel',
  characters: 'characters',
  labels: 'labels',
  local: 'the map’s own tags and locks',
};
