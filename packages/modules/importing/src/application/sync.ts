import { actorRef, hasMapRole, mapStream, newEvent, newId } from '@darkbeacon/core';
import { WandererApiSourceRequest, WandererDbSourceRequest } from '@darkbeacon/shared';
import { SourceError } from '../domain/errors.js';
import { parseWandererBase, parseWandererSlug } from '../domain/source-url.js';
import { translate } from '../domain/translate.js';
import type { ImportJobRecord, ImportSyncRecord } from '../ports/repositories.js';
import type { ImportingDeps } from './deps.js';
import { emptyOutcomes } from './planner.js';
import { dbRequest } from './service.js';

/** A sync stops after this many failed pulls in a row (and on a refused key at once). */
const MAX_FAILURES = 5;

/**
 * "Keep syncing" during a move: every N minutes each switched-on sync pulls its Wanderer map
 * again and queues a merge into its map, as the account that set it up. A sync stops by itself
 * when that account is no longer a manager of the map, when Wanderer refuses the key, or after
 * a few failures in a row; every start and stop is an `import.sync_changed` event on the map.
 */
export class SyncScheduler {
  private running = false;

  constructor(private readonly deps: ImportingDeps) {}

  /** Pulls every sync that is due; returns how many jobs it queued. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let queued = 0;
      for (const sync of await this.deps.syncs.due(this.deps.clock.now())) {
        if (await this.pull(sync)) queued++;
      }
      if (queued > 0) this.deps.wake();
      return queued;
    } finally {
      this.running = false;
    }
  }

  private async pull(sync: ImportSyncRecord): Promise<boolean> {
    const { deps } = this;
    const now = deps.clock.now();
    sync.lastRunAt = now;
    sync.nextRunAt = now + sync.intervalMinutes * 60_000;

    const role = await deps.target.roleOf(sync.actor, sync.mapId).catch(() => null);
    if (!hasMapRole(role, 'manager')) {
      await this.stop(sync, 'The account that set it up is no longer a manager of the map');
      return false;
    }
    // The previous pull is still being written: skip this turn.
    const previous = sync.lastJobId ? await deps.jobs.find(sync.lastJobId) : null;
    if (previous && (previous.status === 'queued' || previous.status === 'running')) {
      await deps.syncs.update(sync);
      return false;
    }
    try {
      const sealed: unknown = JSON.parse(deps.secrets.open(sync.sealedSource));
      const fromDatabase = WandererDbSourceRequest.safeParse(sealed);
      const dump = fromDatabase.success
        ? await deps.sources.db.read(dbRequest(fromDatabase.data))
        : await this.readApi(WandererApiSourceRequest.parse(sealed));
      const { report, counts, plan } = translate(dump, { systemName: (id) => deps.universe.systemName(id) });
      const job: ImportJobRecord = {
        id: newId(),
        actor: sync.actor,
        status: 'queued',
        source: dump.source,
        mode: 'merge',
        mapId: sync.mapId,
        mapSlug: null,
        mapName: plan.mapName,
        phase: 'queued',
        done: 0,
        total: 0,
        dump,
        counts,
        report,
        access: [],
        outcome: emptyOutcomes(),
        warnings: [...dump.warnings],
        error: null,
        options: { includeAccess: true, removeMissing: sync.removeMissing },
        sealedSource: null,
        syncId: sync.id,
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
      };
      await deps.jobs.insert(job);
      sync.lastJobId = job.id;
      sync.lastError = null;
      sync.failures = 0;
      await deps.syncs.update(sync);
      return true;
    } catch (error) {
      sync.failures++;
      sync.lastError = error instanceof Error ? error.message : 'Unexpected error';
      const refused = error instanceof SourceError && error.failure === 'auth';
      if (refused || sync.failures >= MAX_FAILURES)
        await this.stop(
          sync,
          refused
            ? `Wanderer refused the API key: ${sync.lastError}`
            : `Stopped after ${sync.failures} failed pulls: ${sync.lastError}`,
        );
      else await deps.syncs.update(sync);
      return false;
    }
  }

  private async readApi(request: WandererApiSourceRequest) {
    const allowPrivate = await this.deps.policy.allowPrivateNetworks();
    return this.deps.sources.api.read({
      kind: 'wanderer-api',
      base: parseWandererBase(request.baseUrl, { allowPlainHttp: allowPrivate }),
      slug: parseWandererSlug(request.slug),
      apiKey: request.apiKey,
      aclKeys: request.aclKeys ?? [],
      insecureTls: request.insecureTls ?? false,
      allowPrivate,
    });
  }

  private async stop(sync: ImportSyncRecord, reason: string): Promise<void> {
    const { deps } = this;
    sync.enabled = false;
    sync.nextRunAt = null;
    sync.lastError = reason;
    await deps.uow.transaction(async () => {
      await deps.syncs.update(sync);
      await deps.events.append([
        newEvent({
          stream: mapStream(sync.mapId),
          type: 'import.sync_changed',
          actor: actorRef(sync.actor),
          data: {
            syncId: sync.id,
            source: sync.source,
            enabled: false,
            intervalMinutes: sync.intervalMinutes,
            reason,
          },
          occurredAt: deps.clock.now(),
        }),
      ]);
    });
  }
}
