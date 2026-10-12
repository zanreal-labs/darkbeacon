import {
  AUDIT_STREAM,
  ConflictError,
  DomainError,
  INSTANCE_STREAM,
  isInstanceAdmin,
  mapStream,
  NotFoundError,
  requireInstanceRole,
  requireMapRole,
  ValidationError,
  type Actor,
  type AuditScope,
  type Clock,
  type MapAccess,
} from '@darkbeacon/core';
import type {
  AuditEntryDto,
  AuditPageDto,
  AuditQuery,
  AuditRevertDto,
  AuditVerifyDto,
  UndoFailureDto,
  UndoResultDto,
} from '@darkbeacon/shared';
import { decodeCursor, encodeCursor, toEntry, type StoredEvent } from '../domain/entries.js';
import { undoPlan } from '../domain/undo.js';
import type {
  AuditFilter,
  AuditScopeFilter,
  AuditStore,
  ChangeReverter,
  RevertContext,
} from '../ports/index.js';

export interface AuditTrailDeps {
  store: AuditStore;
  access: MapAccess;
  scope: AuditScope;
  clock: Clock;
}

const PAGE = 50;
/** One gesture never makes more changes than this (a paste of a big selection at most). */
const ACTION_LIMIT = 2_000;
/** Exports stop here; narrow the filters (time, person, type) for more. */
export const EXPORT_LIMIT = 50_000;
const EXPORT_PAGE = 500;

/** Where a map history looks: the whole map, or one system or connection on it. */
export type MapFocus = { solarSystemId: number } | { connectionId: string } | null;

/**
 * The audit trail: histories of a map (all of it, one system, one connection) and of the
 * instance, exports, reverting one change, and the hash chain check.
 */
export class AuditTrail {
  private readonly reverters = new Map<string, ChangeReverter>();

  constructor(private readonly deps: AuditTrailDeps) {}

  /** Modules that own state offer reverts of their changes (mapping in the composition root). */
  registerReverter(reverter: ChangeReverter): void {
    for (const type of reverter.types) this.reverters.set(type, reverter);
  }

  canRevert(type: string): boolean {
    return this.reverters.has(type);
  }

  async mapHistory(
    actor: Actor | null,
    mapId: string,
    query: AuditQuery,
    focus: MapFocus = null,
  ): Promise<AuditPageDto> {
    const showOrigin = await this.mapView(actor, mapId);
    return this.page(this.mapFilter(mapId, query, focus), query, showOrigin, true);
  }

  async mapExport(actor: Actor | null, mapId: string, query: AuditQuery): Promise<AuditEntryDto[]> {
    const showOrigin = await this.mapView(actor, mapId);
    return this.everything(this.mapFilter(mapId, query, null), showOrigin, true);
  }

  async instanceAudit(actor: Actor | null, query: AuditQuery): Promise<AuditPageDto> {
    requireInstanceRole(actor, 'admin');
    return this.page(this.instanceFilter(query), query, true, false);
  }

  async instanceExport(actor: Actor | null, query: AuditQuery): Promise<AuditEntryDto[]> {
    requireInstanceRole(actor, 'admin');
    return this.everything(this.instanceFilter(query), true, false);
  }

  /**
   * Undoes one change of the map, when the reverter says it is safe. The revert runs as `actor`
   * through the owning module and is recorded with `revertOf`.
   */
  async revert(actor: Actor | null, mapId: string, eventId: string): Promise<AuditRevertDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'member');
    const stored = await this.deps.store.find(eventId);
    if (!stored || stored.event.stream !== mapStream(mapId)) throw new NotFoundError('Change');
    const reverter = this.reverters.get(stored.event.type);
    if (!reverter || !stored.audit) throw new ValidationError('This change cannot be reverted');
    if ((await this.deps.store.revertsOf([eventId])).has(eventId))
      throw new ConflictError('This change was already reverted');
    await this.deps.scope.run({ revertOf: eventId }, () => reverter.revert(actor!, mapId, stored));
    const written = await this.deps.store.writtenBy(eventId);
    if (written.length === 0) throw new ConflictError('Nothing to revert: it already looks like before');
    const showOrigin = await this.mapView(actor, mapId);
    return {
      reverted: eventId,
      entries: written.map((s) =>
        toEntry(s, { showOrigin, revertible: this.canRevert(s.event.type), revertedBy: null }),
      ),
    };
  }

  /**
   * Undoes one gesture of `actor` on the map: every change recorded with the action id that is
   * still standing, in the order `undoPlan` gives, each reverted like `revert` does. A change that
   * changed again since stays and is reported; nothing at all undone is a ConflictError.
   */
  async undo(actor: Actor | null, mapId: string, action: string): Promise<UndoResultDto> {
    await requireMapRole(this.deps.access, actor, mapId, 'member');
    const accountId = actor?.kind === 'account' ? actor.id : null;
    const stream = mapStream(mapId);
    const recorded = (await this.deps.store.byRef(stream, `action:${action}`, ACTION_LIMIT)).filter(
      // Only the caller's own changes: an action id is theirs, but the check costs nothing.
      (s) => s.audit && s.audit.actor.accountId === accountId && !s.audit.revertOf,
    );
    if (recorded.length === 0) throw new NotFoundError('Change');
    const reverted = await this.deps.store.revertsOf(recorded.map((s) => s.event.id));
    const standing = recorded.filter((s) => !reverted.has(s.event.id) && this.canRevert(s.event.type));
    if (standing.length === 0) throw new ConflictError('This was already undone');

    const context: RevertContext = { connectionIds: new Map() };
    const done: string[] = [];
    const failed: UndoFailureDto[] = [];
    for (const stored of undoPlan(standing)) {
      const reverter = this.reverters.get(stored.event.type)!;
      try {
        await this.deps.scope.run({ revertOf: stored.event.id, action: undefined }, () =>
          reverter.revert(actor!, mapId, stored, context),
        );
        done.push(stored.event.id);
      } catch (error) {
        // Refused (changed since, gone, locked meanwhile): it stays, the rest is still undone.
        if (!(error instanceof DomainError) || error.code === 'unauthenticated') throw error;
        failed.push({ eventId: stored.event.id, type: stored.event.type, reason: error.message });
      }
    }
    if (done.length === 0) throw new ConflictError(failed[0]?.reason ?? 'Nothing to undo', { failed });
    const showOrigin = await this.mapView(actor, mapId);
    const written = (await Promise.all(done.map((id) => this.deps.store.writtenBy(id)))).flat();
    return {
      action,
      reverted: done,
      entries: written.map((s) =>
        toEntry(s, { showOrigin, revertible: this.canRevert(s.event.type), revertedBy: null }),
      ),
      failed,
    };
  }

  async verify(actor: Actor | null): Promise<AuditVerifyDto> {
    requireInstanceRole(actor, 'admin');
    const streams = await this.deps.store.verify();
    return { ok: streams.every((s) => s.ok), checkedAt: this.deps.clock.now(), streams };
  }

  /** Viewers read map histories; map admins and instance admins also see where changes came from. */
  private async mapView(actor: Actor | null, mapId: string): Promise<boolean> {
    const role = await requireMapRole(this.deps.access, actor, mapId, 'viewer');
    return role === 'admin' || isInstanceAdmin(actor);
  }

  private mapFilter(mapId: string, query: AuditQuery, focus: MapFocus): AuditFilter {
    const refs = personRefs(query);
    if (focus && 'solarSystemId' in focus) refs.push(`system:${focus.solarSystemId}`);
    else if (focus) refs.push(`connection:${focus.connectionId}`);
    else if (query.solarSystemId) refs.push(`system:${query.solarSystemId}`);
    return { scopes: [{ stream: mapStream(mapId) }], types: query.types, refs, since: query.since };
  }

  /**
   * Instance audit: the instance stream (roles, plugins, characters leaving accounts), the audit
   * stream (sign-ins, settings, themes, webhooks, plugin settings) and access rule changes of
   * every map. With `mapId`: that map's access rules and webhooks only, not its map state.
   */
  private instanceFilter(query: AuditQuery): AuditFilter {
    const scopes: AuditScopeFilter[] = query.mapId
      ? [
          { stream: mapStream(query.mapId), typePrefix: 'access.' },
          { stream: AUDIT_STREAM, ref: `map:${query.mapId}` },
        ]
      : [
          { stream: INSTANCE_STREAM },
          { stream: AUDIT_STREAM },
          { streamPrefix: 'map:', typePrefix: 'access.' },
        ];
    return { scopes, types: query.types, refs: personRefs(query), since: query.since };
  }

  private async page(
    filter: AuditFilter,
    query: AuditQuery,
    showOrigin: boolean,
    revertible: boolean,
  ): Promise<AuditPageDto> {
    const limit = query.limit ?? PAGE;
    const rows = await this.deps.store.page(filter, decodeCursor(query.before), limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      entries: await this.entries(page, showOrigin, revertible),
      nextCursor:
        more && last
          ? encodeCursor({
              occurredAt: last.event.occurredAt,
              seq: last.event.seq,
              stream: last.event.stream,
            })
          : null,
    };
  }

  private async everything(
    filter: AuditFilter,
    showOrigin: boolean,
    revertible: boolean,
  ): Promise<AuditEntryDto[]> {
    const out: AuditEntryDto[] = [];
    let before = null;
    while (out.length < EXPORT_LIMIT) {
      const rows = await this.deps.store.page(filter, before, EXPORT_PAGE);
      out.push(...(await this.entries(rows, showOrigin, revertible)));
      const last = rows.at(-1);
      if (rows.length < EXPORT_PAGE || !last) break;
      before = { occurredAt: last.event.occurredAt, seq: last.event.seq, stream: last.event.stream };
    }
    return out.slice(0, EXPORT_LIMIT);
  }

  private async entries(
    rows: StoredEvent[],
    showOrigin: boolean,
    revertible: boolean,
  ): Promise<AuditEntryDto[]> {
    const reverted = await this.deps.store.revertsOf(rows.map((r) => r.event.id));
    return rows.map((row) =>
      toEntry(row, {
        showOrigin,
        revertible: revertible && this.canRevert(row.event.type),
        revertedBy: reverted.get(row.event.id) ?? null,
      }),
    );
  }
}

function personRefs(query: AuditQuery): string[] {
  const refs: string[] = [];
  if (query.accountId) refs.push(`account:${query.accountId}`);
  if (query.characterId) refs.push(`character:${query.characterId}`);
  return refs;
}
