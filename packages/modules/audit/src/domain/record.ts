import type { ActorRef, AuditContext, NewEvent } from '@darkbeacon/core';
import type {
  AuditActorDto,
  AuditChannelDto,
  AuditFieldChange,
  AuditMapRefDto,
  AuditOp,
  AuditOriginDto,
} from '@darkbeacon/shared';
import { describe, type AuditEntity } from './catalogue.js';
import { asFields, fieldDiff, snapshot, type Fields } from './diff.js';

/** What the audit trail stores with an event (the `audit` column of `event_log`). */
export interface AuditRecord {
  actor: AuditActorDto;
  channel: AuditChannelDto;
  origin: AuditOriginDto | null;
  op: AuditOp;
  entity: AuditEntity | null;
  diff: Record<string, AuditFieldChange>;
  removed: Fields | null;
  revertOf: string | null;
  /** Made on a map that merges this one and written back here. Absent on older records. */
  via?: AuditMapRefDto | null;
  /** Written by a map that merges others, from this source map. Absent on older records. */
  mergedFrom?: AuditMapRefDto | null;
}

/** Names and characters of the people behind an event, looked up when it is written. */
export interface ActorFacts {
  accountId: string | null;
  accountName: string | null;
  characterId: number | null;
  characterName: string | null;
}

export const NO_FACTS: ActorFacts = {
  accountId: null,
  accountName: null,
  characterId: null,
  characterName: null,
};

/** The character an event is about (tracking, passages); the actor in use for system processes. */
export function subjectCharacter(event: Pick<NewEvent, 'type' | 'data'>): number | null {
  const fields = asFields(event.data);
  return fields ? (describe(event.type).subjectCharacter?.(fields) ?? null) : null;
}

/** The channel when nothing more specific is known: from the actor kind. */
export function defaultChannel(actor: ActorRef): AuditChannelDto {
  switch (actor.kind) {
    case 'apiToken':
      return { kind: 'api', id: actor.id };
    case 'plugin':
      return { kind: 'plugin', id: actor.id };
    case 'system':
      return { kind: 'system', id: actor.id };
    default:
      // An account acting outside a request (startup work); requests set `web` themselves.
      return { kind: 'system', id: null };
  }
}

/**
 * The audit record of one event and the refs it is found by. Updates diff against
 * `event.before`; an update without a known before reads as a create; removals keep `before`.
 */
export function buildAuditRecord(
  event: NewEvent,
  context: AuditContext,
  facts: ActorFacts,
): { record: AuditRecord; refs: string[] } {
  const descriptor = describe(event.type);
  const data = asFields(event.data) ?? {};
  const before = asFields(event.before);
  const ignore = descriptor.ignore ?? [];
  const state = (value: Fields | null) => (value && descriptor.state ? descriptor.state(value) : value);

  let op: AuditOp = descriptor.op;
  if (op === 'update' && !before) op = 'create';
  let diff: Record<string, AuditFieldChange> = {};
  let removed: Fields | null = null;
  if (op === 'create' || op === 'update') diff = fieldDiff(state(before), state(data), ignore);
  else if (op === 'delete') removed = snapshot(before ?? data, ignore);
  else diff = descriptor.activity?.(data) ?? fieldDiff(null, data, ignore);

  const actor: AuditActorDto = {
    kind: event.actor.kind,
    id: event.actor.id,
    accountId: facts.accountId,
    accountName: facts.accountName,
    characterId: facts.characterId,
    characterName: facts.characterName,
  };
  const channel: AuditChannelDto = context.channel
    ? {
        kind: context.channel.kind,
        id: context.channel.id ?? null,
        ...(context.channel.name !== undefined ? { name: context.channel.name } : {}),
      }
    : defaultChannel(event.actor);

  const refs = new Set(descriptor.refs?.(data, before) ?? []);
  if (facts.accountId) refs.add(`account:${facts.accountId}`);
  if (facts.characterId) refs.add(`character:${facts.characterId}`);

  return {
    record: {
      actor,
      channel,
      origin: context.origin ?? null,
      op,
      entity: descriptor.entity(data, before),
      diff,
      removed,
      revertOf: context.revertOf ?? null,
      ...(context.via ? { via: context.via } : {}),
      ...(context.mergedFrom ? { mergedFrom: context.mergedFrom } : {}),
    },
    refs: [...refs],
  };
}

/** A record has an actor and says what changed: a non-empty diff or the removed snapshot. */
export function isComplete(record: AuditRecord): boolean {
  return (
    !!record.actor.kind &&
    !!record.actor.id &&
    (Object.keys(record.diff).length > 0 ||
      (record.removed !== null && Object.keys(record.removed).length > 0))
  );
}
