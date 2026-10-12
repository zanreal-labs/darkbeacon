import { newId } from './ids.js';

export type ActorKind = 'account' | 'apiToken' | 'public' | 'system' | 'plugin';

/** Who caused an event, as recorded in the envelope. */
export interface ActorRef {
  kind: ActorKind;
  id: string;
}

/** The envelope every state change is published in (see SPEC "Events"). */
export interface DomainEvent<T = unknown> {
  id: string;
  seq: number;
  stream: string;
  type: string;
  occurredAt: number;
  actor: ActorRef;
  data: T;
  v: 1;
}

/** An event before the log assigns its `seq`. */
export interface NewEvent<T = unknown> {
  id: string;
  stream: string;
  type: string;
  occurredAt: number;
  actor: ActorRef;
  data: T;
  /**
   * The changed entity as it was before (updates) or the entity that is gone (removals). Only
   * the audit trail reads it, for the field-level diff and the removed snapshot; it is never
   * part of the published envelope.
   */
  before?: unknown;
}

export const INSTANCE_STREAM = 'instance';

/**
 * Audit records of instance changes that are not map state and must not reach every signed-in
 * account (sign-ins, settings, themes, webhooks, plugin settings). Instance admins only.
 */
export const AUDIT_STREAM = 'audit:instance';

export function mapStream(mapId: string): string {
  return `map:${mapId}`;
}

/** Splits `map:<id>` into kind and id; `instance` has an empty id. */
export function parseStream(stream: string): { kind: string; id: string } | null {
  if (stream === INSTANCE_STREAM) return { kind: INSTANCE_STREAM, id: '' };
  const at = stream.indexOf(':');
  if (at <= 0 || at === stream.length - 1) return null;
  return { kind: stream.slice(0, at), id: stream.slice(at + 1) };
}

/** Builds a NewEvent with a fresh id. Pass `clock.now()` as `occurredAt`. */
export function newEvent<T>(input: {
  stream: string;
  type: string;
  actor: ActorRef;
  data: T;
  occurredAt: number;
  before?: unknown;
}): NewEvent<T> {
  return { id: newId(), ...input };
}
