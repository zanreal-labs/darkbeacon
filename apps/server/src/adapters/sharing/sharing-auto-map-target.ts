import { noAuditScope, type Actor, type AuditScope } from '@darkbeacon/core';
import { LOCAL_INSTANCE } from '@darkbeacon/shared';
import { SELF, type ChainMerger, type ChainWrites } from '@darkbeacon/sharing';
import type { AutoMapTarget, RecordedJump, TrackingRepository } from '@darkbeacon/tracking';

/** Sharing's merger and writes, found once the application is up (sharing depends on tracking). */
export type SharingLookup = () => { merger: ChainMerger; writes: ChainWrites } | null;

/**
 * Auto-mapping on merged maps. A jump is recorded once: when a map merged here also tracks the
 * character, that map records it and the merged map sees it through the merge. Otherwise a map
 * with objects of its own records it there as before, and a composite writes it to its sources.
 */
export class SharingAutoMapTarget implements AutoMapTarget {
  constructor(
    private readonly base: AutoMapTarget,
    private readonly sharing: SharingLookup,
    private readonly tracking: Pick<TrackingRepository, 'listTracked'>,
    private readonly audit: AuditScope = noAuditScope,
  ) {}

  scopes(mapId: string) {
    return this.base.scopes(mapId);
  }

  rules(mapId: string) {
    return this.base.rules ? this.base.rules(mapId) : Promise.resolve(null);
  }

  /** Only on maps of their own: a merged map shows its sources' systems. */
  async placeSystem(input: { mapId: string; solarSystemId: number; characterId: number; accountId: string }) {
    const sharing = this.sharing();
    if (sharing && (await sharing.merger.state(input.mapId))) return;
    await this.base.placeSystem?.(input);
  }

  async recordJump(jump: RecordedJump): Promise<void> {
    const sharing = this.sharing();
    const merged = sharing ? await sharing.merger.state(jump.mapId) : null;
    if (!sharing || !merged) return this.base.recordJump(jump);
    const sources = new Set(
      merged.sources
        .filter((s) => s.id !== SELF && !s.hidden && s.origin.instance === LOCAL_INSTANCE)
        .map((s) => s.origin.mapId),
    );
    const trackedThere = (await this.tracking.listTracked()).some(
      (t) => t.characterId === jump.characterId && sources.has(t.mapId),
    );
    if (trackedThere) return;
    if (merged.info.kind !== 'composite') return this.base.recordJump(jump);
    const owner: Actor = { kind: 'account', id: jump.accountId, instanceRole: 'user' };
    await this.audit.run(
      { channel: { kind: 'system', id: 'auto-mapping' }, characterId: jump.characterId },
      () => sharing.writes.recordJump(owner, jump.mapId, jump),
    );
  }
}
