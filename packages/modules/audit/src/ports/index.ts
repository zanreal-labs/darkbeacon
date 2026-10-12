import type { Actor } from '@darkbeacon/core';
import type { AuditStreamCheckDto } from '@darkbeacon/shared';
import type { AuditCursor, StoredEvent } from '../domain/entries.js';

export type { AuditScope, Clock, MapAccess } from '@darkbeacon/core';

/** Names behind ids, read when an event is written (so later renames do not rewrite history). */
export interface AuditDirectory {
  account(accountId: string): Promise<{
    name: string;
    mainCharacterId: number | null;
    mainCharacterName: string | null;
  } | null>;
  character(characterId: number): Promise<{
    name: string;
    accountId: string | null;
    accountName: string | null;
  } | null>;
}

/** One part of a history: a stream (or streams by kind), optionally only some types or refs. */
export interface AuditScopeFilter {
  stream?: string;
  /** Every stream of a kind, e.g. `map:` for all maps. */
  streamPrefix?: string;
  /** Only types starting with this, e.g. `access.`. */
  typePrefix?: string;
  /** Only events found by this ref, e.g. `map:<id>`. */
  ref?: string;
}

export interface AuditFilter {
  /** OR-ed parts; at least one. */
  scopes: AuditScopeFilter[];
  /** Exact types or `prefix.*`. */
  types?: readonly string[];
  /** Every ref must match (`system:<id>`, `connection:<id>`, `account:<id>`, `character:<id>`). */
  refs?: readonly string[];
  since?: number;
}

/** Reads the event log with its audit records. */
export interface AuditStore {
  /** Newest first, strictly older than `before`. */
  page(filter: AuditFilter, before: AuditCursor | null, limit: number): Promise<StoredEvent[]>;
  find(eventId: string): Promise<StoredEvent | null>;
  /** For each given id that was reverted: the id of the (latest) reverting event. */
  revertsOf(eventIds: readonly string[]): Promise<Map<string, string>>;
  /** Events written while reverting `eventId`. */
  writtenBy(revertOf: string): Promise<StoredEvent[]>;
  /** Checks the hash chain of every stream. */
  verify(): Promise<AuditStreamCheckDto[]>;
}

/** Undoes one kind of change; provided by the module that owns the state (mapping). */
export interface ChangeReverter {
  readonly types: readonly string[];
  /**
   * Puts things back as they were before `entry`. Throws ConflictError when they changed since
   * (the revert would overwrite someone else's later change). Runs as `actor`, through the
   * owning module's use cases, so it is authorized and recorded like any change.
   */
  revert(actor: Actor, mapId: string, entry: StoredEvent): Promise<void>;
}
