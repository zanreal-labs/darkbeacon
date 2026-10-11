import { newId } from './ids.js';

export type ActorKind = 'account' | 'apiToken' | 'system' | 'plugin';

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
}

export const INSTANCE_STREAM = 'instance';

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
}): NewEvent<T> {
  return { id: newId(), ...input };
}
