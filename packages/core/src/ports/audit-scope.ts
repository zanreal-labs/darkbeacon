/** Where a change came from, recorded with every event (see the audit trail). */
export type AuditChannelKind = 'web' | 'api' | 'plugin' | 'system';

export interface AuditChannel {
  kind: AuditChannelKind;
  /** API token id, plugin id, or the system process (`auto-mapping`, `esi`, `identity`...). */
  id?: string;
}

/** What the request looked like, when the change came over HTTP. */
export interface AuditOrigin {
  /** ISO 3166 country code from a trusted proxy header, when one is configured in front. */
  country: string | null;
  userAgent: string | null;
}

/** Facts about the current change that the actor alone does not carry. */
export interface AuditContext {
  channel?: AuditChannel;
  /** The character the change was made with (auto-mapping: the character that jumped). */
  characterId?: number;
  origin?: AuditOrigin;
  /** Set while reverting: the id of the event being reverted. */
  revertOf?: string;
  /** Made on a map that merges this one and written back here ("via <map>"). */
  via?: AuditMapRef;
  /** Written by a map that merges others: the source map the change came from. */
  mergedFrom?: AuditMapRef;
}

/** A map named in an audit record, possibly on another instance (`local` for this one). */
export interface AuditMapRef {
  instance: string;
  mapId: string;
  name: string;
}

/**
 * Carries an AuditContext through the async work of one change. The HTTP edge opens one per
 * request; background work (auto-mapping) adds its own facts with `run`.
 */
export interface AuditScope {
  /** Runs `work` with `context` merged over the current facts. */
  run<T>(context: AuditContext, work: () => Promise<T>): Promise<T>;
  current(): AuditContext;
}

/** An AuditScope that records nothing extra (tests, tools). */
export const noAuditScope: AuditScope = {
  run: (_context, work) => work(),
  current: () => ({}),
};
