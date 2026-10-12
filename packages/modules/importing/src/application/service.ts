import {
  actorRef,
  ConflictError,
  ForbiddenError,
  hasMapRole,
  isInstanceAdmin,
  mapStream,
  newEvent,
  newId,
  NotFoundError,
  requireAccount,
  ValidationError,
  type AccountActor,
  type Actor,
} from '@darkbeacon/core';
import type {
  ImportJobDto,
  ImportPlanDto,
  ImportPlanRequest,
  ImportSyncDto,
  StartImportRequest,
  WandererApiSourceRequest,
  WandererTestResultDto,
} from '@darkbeacon/shared';
import { SourceError } from '../domain/errors.js';
import { parseWandererBase, parseWandererSlug } from '../domain/source-url.js';
import { translate } from '../domain/translate.js';
import type { WandererMapDump } from '../domain/wanderer.js';
import type { ImportJobRecord } from '../ports/repositories.js';
import type { WandererApiRequest } from '../ports/source.js';
import type { ImportingDeps } from './deps.js';
import { assess, characterNames, emptyOutcomes, LinkIndex, type TargetState } from './planner.js';
import type { ImportRunner } from './runner.js';
import { accessEntries, sourceKey, toJobDto, toSyncDto } from './views.js';

/** Reads of other servers per account: at most this many in this window, one at a time. */
const READ_LIMIT = { count: 12, windowMs: 10 * 60_000 };
/** Conflicts listed in a plan; the rest are counted. */
const MAX_CONFLICTS = 100;

/**
 * Importing a Wanderer map: test the connection, read the map into a preview (counts, mapping
 * report, access rules with today's names), see what an import into a new map or a merge into an
 * existing one would do, start it as a job, follow it, cancel it, download its report, and stop
 * a map's sync. Any signed-in account may import into a new map (it becomes its owner); merging
 * needs a map manager, and access rules a map admin.
 */
export class ImportService {
  private readonly reads = new Map<string, number[]>();
  private readonly reading = new Set<string>();

  constructor(
    private readonly deps: ImportingDeps,
    private readonly runner: ImportRunner,
  ) {}

  async test(actor: Actor | null, request: WandererApiSourceRequest): Promise<WandererTestResultDto> {
    const account = requireAccount(actor);
    const source = await this.apiRequest(account, request);
    return this.limited(account, async () => {
      try {
        const { systems } = await this.deps.sources.api.test(source);
        return { ok: true, host: source.base.host, systems, message: null };
      } catch (error) {
        if (error instanceof SourceError)
          return { ok: false, host: source.base.host, systems: 0, message: error.message };
        throw error;
      }
    });
  }

  /** Reads the whole map from a Wanderer instance and stages it as a preview. */
  async previewApi(actor: Actor | null, request: WandererApiSourceRequest): Promise<ImportJobDto> {
    const account = requireAccount(actor);
    const source = await this.apiRequest(account, request);
    const dump = await this.limited(account, () => this.deps.sources.api.read(source));
    const sealed = this.deps.secrets.seal(
      JSON.stringify({
        ...request,
        baseUrl: source.base.url,
        slug: source.slug,
      } satisfies WandererApiSourceRequest),
    );
    return this.stage(account, dump, sealed);
  }

  /** Stages an uploaded Wanderer export file (parsed and size-limited at the edge). */
  async previewFile(actor: Actor | null, document: unknown, fileName: string | null): Promise<ImportJobDto> {
    const account = requireAccount(actor);
    const dump = await this.deps.sources.file.read({ kind: 'wanderer-file', document, fileName });
    return this.stage(account, dump, null);
  }

  async get(actor: Actor | null, jobId: string): Promise<ImportJobDto> {
    return toJobDto(await this.own(actor, jobId));
  }

  /** May `actor` follow the job's progress stream? */
  async canFollow(actor: Actor | null, jobId: string): Promise<boolean> {
    return this.own(actor, jobId).then(
      () => true,
      () => false,
    );
  }

  /** What an import into a new map, or a merge into `mapId`, would do now. */
  async plan(actor: Actor | null, jobId: string, request: ImportPlanRequest): Promise<ImportPlanDto> {
    const job = await this.own(actor, jobId);
    const account = job.actor;
    const { plan } = translate(job.dump, { systemName: (id) => this.deps.universe.systemName(id) });
    if (request.mode === 'new') {
      const state: TargetState = {
        labels: [],
        systemLabels: [],
        systems: [],
        connections: [],
        signatures: [],
        rules: [],
      };
      const { outcome } = assess(plan, state, new LinkIndex([]), {
        removeMissing: false,
        includeAccess: true,
      });
      return { mode: 'new', mapId: null, outcome, conflicts: [], moreConflicts: 0, accessBlocked: null };
    }
    if (!request.mapId) throw new ValidationError('Choose the map to merge into');
    const mapId = request.mapId;
    const role = await this.requireMergeRole(account, mapId);
    const admin = hasMapRole(role, 'admin');
    const [map, systems, connections, signatures, rules, links] = await Promise.all([
      this.deps.target.map(account, mapId),
      this.deps.target.systems(account, mapId),
      this.deps.target.connections(account, mapId),
      this.deps.target.signatures(account, mapId),
      admin ? this.deps.access.list(account, mapId) : Promise.resolve(null),
      this.deps.links.list(mapId, sourceKey(job.source)),
    ]);
    const index = new LinkIndex(links);
    const scale = index.get('setting', 'layout')?.written;
    const { plan: placed } = translate(job.dump, {
      systemName: (id) => this.deps.universe.systemName(id),
      layoutScale: typeof scale === 'number' ? scale : null,
      characterName: await characterNames(job.dump, this.deps.names),
    });
    const { outcome, conflicts } = assess(
      placed,
      { labels: map.labels, systemLabels: map.systemLabels, systems, connections, signatures, rules },
      index,
      { removeMissing: false, includeAccess: admin },
    );
    return {
      mode: 'merge',
      mapId,
      outcome,
      conflicts: conflicts.slice(0, MAX_CONFLICTS),
      moreConflicts: Math.max(0, conflicts.length - MAX_CONFLICTS),
      accessBlocked:
        !admin && plan.access.length > 0 ? 'Access rules need a map admin; they will be left out' : null,
    };
  }

  /** Starts a staged import as a job. */
  async start(actor: Actor | null, jobId: string, request: StartImportRequest): Promise<ImportJobDto> {
    const job = await this.own(actor, jobId);
    if (job.status !== 'preview')
      throw new ConflictError('This import has started already; read the map again to import it again');
    if (request.keepSyncing && !job.sealedSource)
      throw new ValidationError('Only an import over the API can keep syncing; a file is read once');
    if (request.mode === 'merge') {
      await this.requireMergeRole(job.actor, request.mapId!);
      job.mapId = request.mapId!;
    }
    job.mode = request.mode;
    job.options = {
      includeAccess: request.includeAccess,
      removeMissing: request.mode === 'merge' && request.removeMissing,
      ...(request.name ? { name: request.name } : {}),
      ...(request.slug ? { slug: request.slug } : {}),
      ...(request.keepSyncing
        ? {
            keepSyncing: {
              intervalMinutes: request.keepSyncing.intervalMinutes,
              removeMissing: request.keepSyncing.removeMissing,
            },
          }
        : {}),
    };
    job.status = 'queued';
    job.phase = 'queued';
    job.done = 0;
    job.outcome = emptyOutcomes();
    job.updatedAt = this.deps.clock.now();
    await this.deps.jobs.update(job);
    this.deps.wake();
    return toJobDto(job);
  }

  async cancel(actor: Actor | null, jobId: string): Promise<ImportJobDto> {
    const job = await this.own(actor, jobId);
    if (job.status === 'preview' || job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = job.updatedAt = this.deps.clock.now();
      await this.deps.jobs.update(job);
    } else if (job.status === 'running') this.runner.cancel(job.id);
    return toJobDto(job);
  }

  /**
   * The whole report to download: the job with its mapping report and outcome, and every object
   * that kept Wanderer fields Darkbeacon has no place for (`importedExtra`).
   */
  async report(actor: Actor | null, jobId: string): Promise<Record<string, unknown>> {
    const job = await this.own(actor, jobId);
    const links = job.mapId ? await this.deps.links.list(job.mapId, sourceKey(job.source)) : [];
    return {
      darkbeaconImport: 1,
      job: toJobDto(job),
      importedExtra: links
        .filter((l) => l.extra !== null)
        .map((l) => ({ kind: l.kind, wandererId: l.externalId, darkbeaconId: l.localId, extra: l.extra })),
    };
  }

  /** The map's sync from Wanderer, if one is switched on (viewers may see that it runs). */
  async sync(actor: Actor | null, mapId: string): Promise<ImportSyncDto | null> {
    const role = await this.deps.target.roleOf(requireAccount(actor), mapId);
    if (!hasMapRole(role, 'viewer')) throw new NotFoundError('Map');
    const sync = await this.deps.syncs.activeForMap(mapId);
    return sync ? toSyncDto(sync) : null;
  }

  /** Stops pulling from Wanderer (managers). */
  async stopSync(actor: Actor | null, mapId: string): Promise<void> {
    const account = requireAccount(actor);
    await this.requireMergeRole(account, mapId);
    const sync = await this.deps.syncs.activeForMap(mapId);
    if (!sync) return;
    await this.deps.uow.transaction(async () => {
      sync.enabled = false;
      sync.nextRunAt = null;
      await this.deps.syncs.update(sync);
      await this.deps.events.append([
        newEvent({
          stream: mapStream(mapId),
          type: 'import.sync_changed',
          actor: actorRef(account),
          data: {
            syncId: sync.id,
            source: sync.source,
            enabled: false,
            intervalMinutes: sync.intervalMinutes,
            reason: 'Stopped',
          },
          occurredAt: this.deps.clock.now(),
        }),
      ]);
    });
  }

  /** Previews never started are dropped after a day; finished jobs keep their report only. */
  async prune(): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.jobs.deletePreviewsBefore(now - 24 * 3_600_000);
    await this.deps.jobs.forgetDumpsBefore(now - 7 * 24 * 3_600_000);
  }

  // ---- helpers ----------------------------------------------------------------------------------

  private async stage(
    account: AccountActor,
    dump: WandererMapDump,
    sealedSource: string | null,
  ): Promise<ImportJobDto> {
    const { plan, report, counts } = translate(dump, {
      systemName: (id) => this.deps.universe.systemName(id),
    });
    const ids = plan.access.map((a) => Number(a.subjectId)).filter((id) => Number.isSafeInteger(id));
    const names = ids.length > 0 ? await this.deps.names.describe(ids) : new Map();
    const now = this.deps.clock.now();
    const job: ImportJobRecord = {
      id: newId(),
      actor: account,
      status: 'preview',
      source: dump.source,
      mode: null,
      mapId: null,
      mapSlug: null,
      mapName: plan.mapName,
      phase: 'preview',
      done: 0,
      total: 0,
      dump,
      counts,
      report,
      access: accessEntries(plan.access, names),
      outcome: emptyOutcomes(),
      warnings: [...dump.warnings],
      error: null,
      options: null,
      sealedSource,
      syncId: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    await this.deps.jobs.insert(job);
    return toJobDto(job);
  }

  private async own(actor: Actor | null, jobId: string): Promise<ImportJobRecord> {
    const account = requireAccount(actor);
    const job = await this.deps.jobs.find(jobId);
    if (!job || (job.actor.id !== account.id && !isInstanceAdmin(account))) throw new NotFoundError('Import');
    return job;
  }

  private async requireMergeRole(account: AccountActor, mapId: string) {
    const role = await this.deps.target.roleOf(account, mapId);
    if (!hasMapRole(role, 'viewer')) throw new NotFoundError('Map');
    if (!hasMapRole(role, 'manager')) throw new ForbiddenError('Merging into a map needs a map manager');
    if ((await this.deps.target.map(account, mapId)).kind === 'composite')
      throw new ConflictError('This map merges other maps; import into one of the maps it merges');
    return role;
  }

  private async apiRequest(
    account: AccountActor,
    request: WandererApiSourceRequest,
  ): Promise<WandererApiRequest> {
    if (request.insecureTls && !isInstanceAdmin(account))
      throw new ForbiddenError('Only an instance admin may accept a self-signed certificate');
    const allowPrivate = await this.deps.policy.allowPrivateNetworks();
    return {
      kind: 'wanderer-api',
      base: parseWandererBase(request.baseUrl, { allowPlainHttp: allowPrivate }),
      slug: parseWandererSlug(request.slug),
      apiKey: request.apiKey,
      aclKeys: request.aclKeys ?? [],
      insecureTls: request.insecureTls ?? false,
      allowPrivate,
    };
  }

  /** One read of another server at a time per account, and at most READ_LIMIT.count per window. */
  private async limited<T>(account: AccountActor, work: () => Promise<T>): Promise<T> {
    const now = this.deps.clock.now();
    const recent = (this.reads.get(account.id) ?? []).filter((at) => at > now - READ_LIMIT.windowMs);
    if (this.reading.has(account.id))
      throw new ConflictError('A Wanderer map is being read for you already; wait for it');
    if (recent.length >= READ_LIMIT.count)
      throw new ConflictError('Too many reads of Wanderer in a short time; try again in a few minutes');
    this.reads.set(account.id, [...recent, now]);
    this.reading.add(account.id);
    try {
      return await work();
    } finally {
      this.reading.delete(account.id);
    }
  }
}
