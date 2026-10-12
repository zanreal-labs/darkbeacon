import {
  actorRef,
  hasMapRole,
  isDomainError,
  mapStream,
  newEvent,
  newId,
  type Actor,
} from '@darkbeacon/core';
import type { EventPayloads, EventType, MapRole } from '@darkbeacon/shared';
import { decideAccess, decideConnection, decideSignature, decideSystem } from '../domain/decide.js';
import type { ConnectionWrite, SignatureWrite, SystemWrite } from '../domain/decide.js';
import { pairKey, translate, type ImportPlan } from '../domain/translate.js';
import type { ImportJobRecord, ImportLinkRecord, ImportSyncRecord } from '../ports/repositories.js';
import type { ImportingDeps } from './deps.js';
import { emptyOutcomes, labelIdsFor, LinkIndex, type ImportKind } from './planner.js';
import { auditChannel, importStream, sourceKey, toJobDto } from './views.js';

/** Phases of a job, in order. A resumed job starts again at the phase it was in. */
const PHASES = [
  'map',
  'labels',
  'systems',
  'connections',
  'signatures',
  'access',
  'settings',
  'removals',
] as const;
type Phase = (typeof PHASES)[number];

/** Progress is published at most this often (and at every phase change). */
const PUBLISH_EVERY_MS = 400;

class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** The runner was paused (maintenance): the job stops where it is and resumes later. */
class Paused extends Error {
  constructor() {
    super('Paused');
  }
}

/**
 * Runs import jobs, one at a time, in the order they were queued. A job writes through the
 * mapping, access and routing use cases as the account that started it, under an audit channel
 * naming the source, and records what it wrote (links), so running it again (a resumed job, a
 * repeated import, a sync) changes only what changed. Jobs interrupted by a restart are resumed
 * at the phase they were in.
 */
export class ImportRunner {
  private draining: Promise<void> | null = null;
  private again = false;
  private paused = false;
  private readonly cancelled = new Set<string>();

  constructor(private readonly deps: ImportingDeps) {}

  /** Runs queued and interrupted jobs; resolves when none is left. */
  drain(): Promise<void> {
    if (this.paused) return Promise.resolve();
    this.again = true;
    this.draining ??= (async () => {
      try {
        while (this.again) {
          this.again = false;
          await this.loop();
        }
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  /**
   * Stops writing (a backup is being restored): the running job stops before its next object
   * without touching the database again, and stays `running`, so `resume` picks it up where it
   * was (in the restored database, whatever that holds).
   */
  async pause(): Promise<void> {
    this.paused = true;
    await this.draining?.catch(() => undefined);
  }

  resume(): Promise<void> {
    this.paused = false;
    return this.drain();
  }

  /** Stops a running job at the next object it would write. */
  cancel(jobId: string): void {
    this.cancelled.add(jobId);
  }

  private async loop(): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      if (this.paused) return;
      const next = (await this.deps.jobs.listRunnable()).find((j) => !tried.has(j.id));
      if (!next) return;
      tried.add(next.id);
      await this.run(next);
    }
  }

  private async run(record: ImportJobRecord): Promise<void> {
    const job = new JobProgress(record, this.deps);
    try {
      await this.deps.audit.run({ channel: auditChannel(record.source) }, () => this.execute(job));
    } catch (error) {
      if (error instanceof Paused || this.paused) return;
      const cancelled = error instanceof Cancelled;
      await job
        .finish(cancelled ? 'cancelled' : 'failed', cancelled ? null : describe(error))
        .catch(() => undefined);
    } finally {
      this.cancelled.delete(record.id);
    }
  }

  private async execute(job: JobProgress): Promise<void> {
    const { deps } = this;
    const r = job.record;
    const actor: Actor = r.actor;
    const options = r.options ?? { includeAccess: true, removeMissing: false };
    const startAt = PHASES.indexOf(
      (PHASES as readonly string[]).includes(r.phase) ? (r.phase as Phase) : 'map',
    );
    const reached = (phase: Phase) => PHASES.indexOf(phase) >= startAt;
    if (r.status !== 'running') {
      r.status = 'running';
      r.outcome = emptyOutcomes();
    }

    // The map --------------------------------------------------------------------------------
    if (!r.mapId) {
      if (r.mode !== 'new') throw new Error('No map to merge into');
      const plan0 = translate(r.dump, { systemName: (id) => deps.universe.systemName(id) }).plan;
      const created = await deps.target.createMap(actor, {
        name: options.name ?? plan0.mapName,
        ...(options.slug ? { slug: options.slug } : {}),
      });
      r.mapId = created.id;
    }
    const mapId = r.mapId;
    const map = await deps.target.map(actor, mapId);
    if (map.kind === 'composite')
      throw new Error('This map merges other maps; import into one of the maps it merges');
    r.mapSlug = map.slug;
    r.mapName = map.name;
    const key = sourceKey(r.source);
    if (startAt === 0) {
      await job.phase('map');
      await this.mapEvent(actor, mapId, 'import.started', {
        jobId: r.id,
        source: r.source,
        mode: r.mode ?? 'merge',
      });
    }

    const links = new LinkIndex(await deps.links.list(mapId, key));
    const savedScale = links.get('setting', 'layout')?.written;
    const { plan } = translate(r.dump, {
      systemName: (id) => deps.universe.systemName(id),
      layoutScale: typeof savedScale === 'number' ? savedScale : null,
    });
    if (typeof savedScale !== 'number')
      await this.link(mapId, key, 'setting', 'layout', 'layout', plan.layoutScale, null);
    const role = await deps.target.roleOf(actor, mapId);
    const admin = hasMapRole(role, 'admin');
    const accessWanted = options.includeAccess && plan.access.length > 0;
    r.total =
      plan.labels.length +
      plan.systems.length +
      plan.connections.length +
      plan.signatures.length +
      (accessWanted ? plan.access.length : 0) +
      1;
    const out = r.outcome;
    const step = (kind: ImportKind, what: 'created' | 'updated' | 'unchanged' | 'skipped' | 'removed') => {
      out[kind]![what]++;
    };

    // Labels ------------------------------------------------------------------------------------
    let labels = map.labels;
    if (reached('labels')) {
      await job.phase('labels');
      if (plan.labels.length > 0) {
        if (hasMapRole(role, 'manager')) {
          const before = new Set(labels.map((l) => l.name.toLowerCase()));
          labels = await deps.target.ensureLabels(
            actor,
            mapId,
            plan.labels.map(({ name, color, description }) => ({ name, color, description })),
          );
          for (const label of plan.labels)
            step('labels', before.has(label.name.toLowerCase()) ? 'unchanged' : 'created');
        } else {
          for (let i = 0; i < plan.labels.length; i++) step('labels', 'skipped');
          job.warn('Labels need a map manager; systems keep the labels the map has');
        }
      }
      await job.step(plan.labels.length);
    }
    const labelIds = new Map([...labelIdsFor(plan, labels)].filter(([, id]) => !id.startsWith('new:')));

    // Systems -----------------------------------------------------------------------------------
    if (reached('systems')) {
      await job.phase('systems');
      const here = new Map((await deps.target.systems(actor, mapId)).map((s) => [s.solarSystemId, s]));
      for (const planned of plan.systems) {
        this.check(r.id);
        const link = links.get('system', planned.key);
        const decision = decideSystem(
          planned,
          here.get(planned.solarSystemId),
          (link?.written as SystemWrite) ?? null,
          labelIds,
          options,
        );
        await this.item(job, 'systems', planned.name, async () => {
          if (decision.action === 'create' || decision.action === 'update') {
            await deps.uow.transaction(async () => {
              const { outcome } = await deps.target.putSystem(
                actor,
                mapId,
                planned.solarSystemId,
                decision.write,
                planned.createdAt ?? undefined,
                planned.remoteUpdatedAt ?? undefined,
              );
              step('systems', outcome === 'unchanged' ? 'unchanged' : outcome);
              await this.link(
                mapId,
                key,
                'system',
                planned.key,
                String(planned.solarSystemId),
                decision.written,
                planned.extra,
              );
            });
          } else {
            step('systems', 'unchanged');
            await this.link(
              mapId,
              key,
              'system',
              planned.key,
              String(planned.solarSystemId),
              decision.written,
              planned.extra,
            );
          }
        });
      }
    }

    // Connections -------------------------------------------------------------------------------
    if (reached('connections')) {
      await job.phase('connections');
      const visible = new Set(
        (await deps.target.systems(actor, mapId)).filter((s) => s.visible).map((s) => s.solarSystemId),
      );
      const here = new Map(
        (await deps.target.connections(actor, mapId)).map((c) => [pairKey(c.source, c.target), c]),
      );
      for (const planned of plan.connections) {
        this.check(r.id);
        if (!visible.has(planned.source) || !visible.has(planned.target)) {
          step('connections', 'skipped');
          job.warn(`${planned.name}: a system is not shown on the map`);
          await job.step();
          continue;
        }
        const link = links.get('connection', planned.key);
        const decision = decideConnection(
          planned,
          here.get(planned.key),
          (link?.written as ConnectionWrite) ?? null,
        );
        await this.item(job, 'connections', planned.name, async () => {
          await deps.uow.transaction(async () => {
            let localId = here.get(planned.key)?.id;
            if (decision.action === 'create' || decision.action === 'update') {
              const { connection, outcome } = await deps.target.putConnection(
                actor,
                mapId,
                { source: planned.source, target: planned.target },
                decision.write,
                planned.createdAt ?? undefined,
                planned.remoteUpdatedAt ?? undefined,
              );
              localId = connection.id;
              step('connections', outcome);
            } else step('connections', 'unchanged');
            await this.link(mapId, key, 'connection', planned.key, localId!, decision.written, planned.extra);
          });
        });
      }
    }

    // Signatures --------------------------------------------------------------------------------
    if (reached('signatures')) {
      await job.phase('signatures');
      const systems = new Set((await deps.target.systems(actor, mapId)).map((s) => s.solarSystemId));
      const pairs = new Map(
        (await deps.target.connections(actor, mapId)).map((c) => [pairKey(c.source, c.target), c.id]),
      );
      const here = new Map(
        (await deps.target.signatures(actor, mapId)).map((s) => [`${s.solarSystemId}:${s.eveId}`, s]),
      );
      for (const planned of plan.signatures) {
        this.check(r.id);
        if (!systems.has(planned.solarSystemId)) {
          step('signatures', 'skipped');
          await job.step();
          continue;
        }
        const connectionId =
          planned.linkedTo !== null
            ? (pairs.get(pairKey(planned.solarSystemId, planned.linkedTo)) ?? null)
            : null;
        const link = links.get('signature', planned.key);
        const decision = decideSignature(
          planned,
          here.get(planned.key),
          (link?.written as SignatureWrite) ?? null,
          connectionId,
        );
        await this.item(job, 'signatures', planned.name, async () => {
          await deps.uow.transaction(async () => {
            let localId = here.get(planned.key)?.id;
            if (decision.action === 'create' || decision.action === 'update') {
              const { signature, outcome } = await deps.target.putSignature(
                actor,
                mapId,
                planned.solarSystemId,
                planned.eveId,
                decision.write,
                planned.createdAt ?? undefined,
                planned.remoteUpdatedAt ?? undefined,
              );
              localId = signature.id;
              step('signatures', outcome);
            } else step('signatures', 'unchanged');
            await this.link(mapId, key, 'signature', planned.key, localId!, decision.written, planned.extra);
          });
        });
      }
    }

    // Access ------------------------------------------------------------------------------------
    if (reached('access')) {
      await job.phase('access');
      if (!options.includeAccess) {
        for (let i = 0; i < plan.access.length; i++) step('access', 'skipped');
      } else if (plan.access.length > 0 && !admin) {
        for (let i = 0; i < plan.access.length; i++) step('access', 'skipped');
        job.warn('Access rules were not imported: they need a map admin');
        await job.step(plan.access.length);
      } else if (plan.access.length > 0) {
        const rules = new Map(
          (await deps.access.list(actor, mapId)).map((rule) => [
            `${rule.subjectKind}:${rule.subjectId}`,
            rule,
          ]),
        );
        for (const planned of plan.access) {
          this.check(r.id);
          const link = links.get('access', planned.key);
          const base = link ? { role: (link.written as { role: MapRole }).role, ruleId: link.localId } : null;
          const existing = rules.get(planned.key);
          const decision = decideAccess(planned, existing, base);
          await this.item(job, 'access', planned.wandererName ?? planned.key, async () => {
            if (decision.action === 'unchanged') {
              step('access', 'unchanged');
              return;
            }
            if (decision.action === 'replace') await deps.access.remove(actor, mapId, existing!.id);
            const rule = await deps.access.add(actor, mapId, {
              subjectKind: planned.subjectKind,
              subjectId: planned.subjectId,
              role: planned.role,
            });
            step('access', decision.action === 'replace' ? 'updated' : 'created');
            await this.link(mapId, key, 'access', planned.key, rule.id, { role: planned.role }, null);
          });
        }
      }
    }

    // Settings ----------------------------------------------------------------------------------
    if (reached('settings')) {
      await job.phase('settings');
      await this.item(job, 'settings', 'Map settings', () =>
        this.settings(actor, mapId, plan, links, r, role, step),
      );
    }

    // Removals ----------------------------------------------------------------------------------
    if (reached('removals') && options.removeMissing) {
      await job.phase('removals');
      await this.removals(actor, mapId, key, plan, links, job, step);
    }

    await job.finish('done', null);
    if (options.keepSyncing && r.sealedSource && !r.syncId) await this.startSync(r, options.keepSyncing);
  }

  private async settings(
    actor: Actor,
    mapId: string,
    plan: ImportPlan,
    links: LinkIndex,
    r: ImportJobRecord,
    role: MapRole | null,
    step: (kind: 'settings', what: 'created' | 'updated' | 'unchanged' | 'skipped') => void,
  ): Promise<void> {
    const { deps } = this;
    const key = sourceKey(r.source);
    if (plan.hubs.length > 0) {
      if (!hasMapRole(role, 'manager')) step('settings', 'skipped');
      else {
        const current = await deps.target.hubs(actor, mapId);
        const next = [...new Set([...current, ...plan.hubs])].slice(0, 20);
        if (next.length !== current.length) {
          await deps.target.setHubs(actor, mapId, next);
          step('settings', current.length === 0 ? 'created' : 'updated');
        } else step('settings', 'unchanged');
      }
    }
    if (plan.scopes) {
      const map = await deps.target.map(actor, mapId);
      const base = links.get('setting', 'scopes')?.written;
      // A new map takes Wanderer's scope; a map that has its own (not what an import set) keeps it.
      const ours =
        r.mode === 'new' || (Array.isArray(base) && sameSet(base as string[], map.settings.scopes));
      if (!hasMapRole(role, 'admin') || !ours) step('settings', 'skipped');
      else if (sameSet(plan.scopes, map.settings.scopes)) step('settings', 'unchanged');
      else {
        await deps.target.setScopes(actor, mapId, plan.scopes);
        step('settings', 'updated');
      }
      if (ours) await this.link(mapId, key, 'setting', 'scopes', 'scopes', plan.scopes, null);
    }
  }

  /** Removes what came from Wanderer, is gone there and was not changed here since. */
  private async removals(
    actor: Actor,
    mapId: string,
    key: string,
    plan: ImportPlan,
    links: LinkIndex,
    job: JobProgress,
    step: (kind: 'systems' | 'connections' | 'signatures', what: 'removed' | 'skipped') => void,
  ): Promise<void> {
    const { deps } = this;
    const planned = {
      signature: new Set(plan.signatures.map((s) => s.key)),
      connection: new Set(plan.connections.map((c) => c.key)),
      system: new Set(plan.systems.map((s) => s.key)),
    };
    const signatures = new Map((await deps.target.signatures(actor, mapId)).map((s) => [s.id, s]));
    for (const link of links.all('signature')) {
      if (planned.signature.has(link.externalId)) continue;
      const here = signatures.get(link.localId);
      if (here && here.updatedAt <= link.importedAt) {
        await deps.target.removeSignature(actor, mapId, here.id);
        step('signatures', 'removed');
      } else if (here) step('signatures', 'skipped');
      await deps.links.delete(mapId, key, 'signature', link.externalId);
    }
    const connections = new Map((await deps.target.connections(actor, mapId)).map((c) => [c.id, c]));
    for (const link of links.all('connection')) {
      if (planned.connection.has(link.externalId)) continue;
      const here = connections.get(link.localId);
      if (here && here.updatedAt <= link.importedAt) {
        await deps.target.removeConnection(actor, mapId, here.id);
        step('connections', 'removed');
      } else if (here) step('connections', 'skipped');
      await deps.links.delete(mapId, key, 'connection', link.externalId);
    }
    const systems = new Map(
      (await deps.target.systems(actor, mapId)).map((s) => [String(s.solarSystemId), s]),
    );
    for (const link of links.all('system')) {
      if (planned.system.has(link.externalId)) continue;
      const here = systems.get(link.localId);
      if (here?.visible && !here.locked && here.updatedAt <= link.importedAt) {
        await deps.target.hideSystem(actor, mapId, here.solarSystemId);
        step('systems', 'removed');
      } else if (here?.visible) step('systems', 'skipped');
      await deps.links.delete(mapId, key, 'system', link.externalId);
    }
    await job.step(0);
  }

  /** Writes one object; a failure of that object is reported and the job goes on. */
  private async item(
    job: JobProgress,
    kind: ImportKind,
    name: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (fatal(error)) throw error;
      job.record.outcome[kind]!.skipped++;
      job.warn(`${name}: ${describe(error)}`);
    }
    await job.step();
  }

  private check(jobId: string): void {
    if (this.paused) throw new Paused();
    if (this.cancelled.has(jobId)) throw new Cancelled();
  }

  private async link(
    mapId: string,
    sourceKey: string,
    kind: string,
    externalId: string,
    localId: string,
    written: unknown,
    extra: unknown,
  ): Promise<void> {
    const link: ImportLinkRecord = {
      mapId,
      sourceKey,
      kind,
      externalId,
      localId,
      written,
      extra: extra ?? null,
      importedAt: this.deps.clock.now(),
    };
    await this.deps.links.save(link);
  }

  private async mapEvent<K extends EventType>(
    actor: Actor,
    mapId: string,
    type: K,
    data: EventPayloads[K],
  ): Promise<void> {
    await this.deps.events.append([
      newEvent({
        stream: mapStream(mapId),
        type,
        actor: actorRef(actor),
        data,
        occurredAt: this.deps.clock.now(),
      }),
    ]);
  }

  private async startSync(
    r: ImportJobRecord,
    request: { intervalMinutes: number; removeMissing: boolean },
  ): Promise<void> {
    const { deps } = this;
    const now = deps.clock.now();
    const existing = await deps.syncs.activeForMap(r.mapId!);
    const sync: ImportSyncRecord = {
      id: existing?.id ?? newId(),
      mapId: r.mapId!,
      actor: r.actor,
      source: r.source,
      sealedSource: r.sealedSource!,
      intervalMinutes: request.intervalMinutes,
      removeMissing: request.removeMissing,
      enabled: true,
      lastRunAt: now,
      lastJobId: r.id,
      lastError: null,
      failures: 0,
      nextRunAt: now + request.intervalMinutes * 60_000,
      createdAt: existing?.createdAt ?? now,
    };
    await deps.uow.transaction(async () => {
      if (existing) await deps.syncs.update(sync);
      else await deps.syncs.insert(sync);
      r.syncId = sync.id;
      await deps.jobs.update(r);
      await this.mapEvent(r.actor, sync.mapId, 'import.sync_changed', {
        syncId: sync.id,
        source: sync.source,
        enabled: true,
        intervalMinutes: sync.intervalMinutes,
        reason: null,
      });
    });
  }
}

/** Keeps a job's row and its `import:<id>` stream current. */
class JobProgress {
  private lastPublish = 0;

  constructor(
    readonly record: ImportJobRecord,
    private readonly deps: ImportingDeps,
  ) {}

  warn(message: string): void {
    if (this.record.warnings.length < 200 && !this.record.warnings.includes(message))
      this.record.warnings.push(message);
  }

  async step(count = 1): Promise<void> {
    this.record.done = Math.min(this.record.total, this.record.done + count);
    await this.publish(false);
  }

  async phase(name: string): Promise<void> {
    this.record.phase = name;
    await this.publish(true);
  }

  async finish(status: 'done' | 'failed' | 'cancelled', error: string | null): Promise<void> {
    const r = this.record;
    const now = this.deps.clock.now();
    r.status = status;
    r.error = error;
    r.phase = status === 'done' ? 'done' : r.phase;
    if (status === 'done') r.done = r.total;
    r.finishedAt = now;
    await this.publish(true, async () => {
      if (!r.mapId) return;
      await this.deps.events.append([
        newEvent({
          stream: mapStream(r.mapId),
          type: 'import.finished',
          actor: actorRef(r.actor),
          data: { jobId: r.id, source: r.source, status, outcome: r.outcome, error },
          occurredAt: now,
        }),
      ]);
    });
    if (r.syncId)
      await this.deps.syncs.find(r.syncId).then(async (sync) => {
        if (!sync) return;
        sync.lastJobId = r.id;
        sync.lastError = status === 'failed' ? error : null;
        sync.failures = status === 'failed' ? sync.failures + 1 : 0;
        await this.deps.syncs.update(sync);
      });
  }

  private async publish(force: boolean, alsoInTransaction?: () => Promise<void>): Promise<void> {
    const now = this.deps.clock.now();
    if (!force && now - this.lastPublish < PUBLISH_EVERY_MS) return;
    this.lastPublish = now;
    const r = this.record;
    r.updatedAt = now;
    await this.deps.uow.transaction(async () => {
      await this.deps.jobs.update(r);
      await this.deps.events.append([
        newEvent({
          stream: importStream(r.id),
          type: 'import.progress',
          actor: actorRef(r.actor),
          data: toJobDto(r),
          occurredAt: now,
        }),
      ]);
      await alsoInTransaction?.();
    });
  }
}

/** Errors that stop a whole job: the account lost its rights on the map, or the map is gone. */
function fatal(error: unknown): boolean {
  // A value the map refuses (too long, malformed) fails that object only.
  if (!isDomainError(error)) return !(error instanceof Error && error.name === 'ZodError');
  if (error.code === 'forbidden' || error.code === 'unauthenticated') return true;
  return error.code === 'not_found' && error.message === 'Map not found';
}

function describe(error: unknown): string {
  if (isDomainError(error)) return error.message;
  return error instanceof Error ? error.message : 'Unexpected error';
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
