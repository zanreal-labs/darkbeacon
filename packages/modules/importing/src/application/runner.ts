import {
  actorRef,
  hasMapRole,
  isDomainError,
  mapStream,
  newEvent,
  newId,
  type Actor,
} from '@darkbeacon/core';
import type { EventPayloads, EventType, MapRole, SignatureDto } from '@darkbeacon/shared';
import {
  decideAccess,
  decideConnection,
  decideSignature,
  decideSystem,
  removedHere,
} from '../domain/decide.js';
import type { ConnectionWrite, SignatureWrite, SystemWrite } from '../domain/decide.js';
import { pairKey, translate, type ImportPlan, type PlannedSignature } from '../domain/translate.js';
import type { ImportJobRecord, ImportLinkRecord, ImportSyncRecord } from '../ports/repositories.js';
import type { ImportingDeps } from './deps.js';
import {
  characterNames,
  emptyOutcomes,
  labelIdsFor,
  LinkIndex,
  systemLabelIdsFor,
  type ImportKind,
} from './planner.js';
import { auditChannel, importStream, sourceKey, toJobDto } from './views.js';

/** Phases of a job, in order. A resumed job starts again at the phase it was in. */
const PHASES = [
  'map',
  'labels',
  'systems',
  'connections',
  'signatures',
  'passages',
  'structures',
  'comments',
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
      characterName: await characterNames(r.dump, deps.names),
    });
    if (typeof savedScale !== 'number')
      await this.link(mapId, key, 'setting', 'layout', 'layout', plan.layoutScale, null);
    const role = await deps.target.roleOf(actor, mapId);
    const admin = hasMapRole(role, 'admin');
    const accessWanted = options.includeAccess && plan.access.length > 0;
    r.total =
      plan.labels.length +
      plan.systemLabels.length +
      plan.systems.length +
      plan.connections.length +
      plan.signatures.length +
      plan.passages.length +
      plan.structures.length +
      plan.comments.length +
      (accessWanted ? plan.access.length : 0) +
      1;
    const out = r.outcome;
    const step = (kind: ImportKind, what: 'created' | 'updated' | 'unchanged' | 'skipped' | 'removed') => {
      out[kind]![what]++;
    };

    // Labels ------------------------------------------------------------------------------------
    let labels = map.labels;
    let systemLabels = map.systemLabels;
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
          job.warn('Tags need a map manager; systems keep the tags the map has');
        }
      }
      // The map's Labels: a new map takes Wanderer's list as it is, an existing one gains the
      // Labels it lacks by name.
      if (plan.systemLabels.length > 0) {
        if (hasMapRole(role, 'manager')) {
          const before = new Set(systemLabels.map((l) => l.name.toLowerCase()));
          systemLabels = await deps.target.ensureSystemLabels(actor, mapId, plan.systemLabels, {
            replace: r.mode === 'new',
          });
          for (const label of plan.systemLabels)
            step('labels', before.has(label.name.toLowerCase()) ? 'unchanged' : 'created');
        } else {
          for (let i = 0; i < plan.systemLabels.length; i++) step('labels', 'skipped');
          job.warn('Labels need a map manager; systems keep the labels the map has');
        }
      }
      await job.step(plan.labels.length + plan.systemLabels.length);
    }
    const labelIds = new Map([...labelIdsFor(plan, labels)].filter(([, id]) => !id.startsWith('new:')));
    const systemLabelIds = new Map(
      [...systemLabelIdsFor(plan, systemLabels)].filter(([, id]) => !id.startsWith('new:')),
    );

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
          systemLabelIds,
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
      const deletedHere = await deps.target.signatureTombstones(actor, mapId);
      for (const planned of plan.signatures) {
        this.check(r.id);
        if (!systems.has(planned.solarSystemId) || removedHere(planned, here, deletedHere)) {
          step('signatures', 'skipped');
          await job.step();
          continue;
        }
        // Linked to the connection Wanderer links it to, when the map connects the two.
        const leadsTo = planned.linkedTo ?? planned.leadsTo;
        const connectionId =
          leadsTo !== null ? (pairs.get(pairKey(planned.solarSystemId, leadsTo)) ?? null) : null;
        const link = links.get('signature', planned.key);
        const current = here.get(planned.key);
        const decision = decideSignature(
          planned,
          current,
          (link?.written as SignatureWrite) ?? null,
          connectionId,
        );
        await this.item(job, 'signatures', planned.name, async () => {
          await deps.uow.transaction(async () => {
            let localId = current?.id;
            if (current && decision.action === 'unchanged' && seenSince(planned, current, deps.clock.now())) {
              // Pasted again in Wanderer: the same record, its times following Wanderer's (the
              // lazy delete counts from them).
              await deps.target.seeSignature(actor, mapId, current.id, {
                createdAt: planned.createdAt,
                seenAt: planned.seenAt!,
              });
              step('signatures', 'unchanged');
            } else if (decision.action === 'create' || decision.action === 'update') {
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

    // Passages ----------------------------------------------------------------------------------
    if (reached('passages')) {
      await job.phase('passages');
      for (const planned of plan.passages) {
        this.check(r.id);
        await this.item(job, 'passages', 'A passage', async () => {
          const outcome = await deps.target.putPassage(actor, mapId, planned, `${key}:${planned.key}`);
          step(
            'passages',
            outcome === 'created' ? 'created' : outcome === 'unchanged' ? 'unchanged' : 'skipped',
          );
        });
      }
    }

    // Structures and comments: real objects with their authors, owners and timers ----------------
    if (reached('structures')) {
      await job.phase('structures');
      for (const planned of plan.structures) {
        this.check(r.id);
        const link = links.get('structure', planned.key);
        await this.item(job, 'structures', `A structure in ${planned.name}`, async () => {
          await deps.uow.transaction(async () => {
            // Unchanged in Wanderer since the last import: leave what people changed here alone.
            if (link && JSON.stringify(link.written) === JSON.stringify(planned.fields)) {
              step('structures', 'unchanged');
              return;
            }
            const { id, outcome } = await deps.target.putStructure(
              actor,
              mapId,
              {
                solarSystemId: planned.solarSystemId,
                ...planned.fields,
                author: planned.author,
                createdAt: planned.createdAt,
                changedAt: planned.remoteUpdatedAt,
              },
              link?.localId ?? null,
            );
            step('structures', outcome);
            await this.link(mapId, key, 'structure', planned.key, id, planned.fields, null);
          });
        });
      }
    }
    if (reached('comments')) {
      await job.phase('comments');
      for (const planned of plan.comments) {
        this.check(r.id);
        const link = links.get('comment', planned.key);
        await this.item(job, 'comments', `A comment in ${planned.name}`, async () => {
          await deps.uow.transaction(async () => {
            const { id, outcome } = await deps.target.putComment(
              actor,
              mapId,
              {
                solarSystemId: planned.solarSystemId,
                text: planned.text,
                author: planned.author,
                createdAt: planned.createdAt,
              },
              link?.localId ?? null,
            );
            step('comments', outcome);
            if (outcome !== 'unchanged' || !link)
              await this.link(mapId, key, 'comment', planned.key, id, { text: planned.text }, null);
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
        this.settings(actor, mapId, plan, links, r, role, step, (m) => job.warn(m)),
      );
    }

    // Removals ----------------------------------------------------------------------------------
    // A sync's pull always removes the signatures Wanderer deleted (or that a re-scan replaced):
    // they are scan results of the moment, not the map's own. The rest only when asked.
    const pull = Boolean(r.syncId);
    if (reached('removals') && (options.removeMissing || pull)) {
      await job.phase('removals');
      await this.removals(actor, mapId, key, plan, links, job, step, {
        signaturesOnly: !options.removeMissing,
      });
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
    warn: (message: string) => void,
  ): Promise<void> {
    const { deps } = this;
    const key = sourceKey(r.source);
    if (plan.hubs.length > 0) {
      if (!hasMapRole(role, 'manager')) step('settings', 'skipped');
      else {
        // Hubs the map has stay first (the default trade hubs, earlier imports); missing ones are
        // added once, never twice.
        const current = await deps.target.hubs(actor, mapId);
        const wanted = [...new Set([...current, ...plan.hubs])];
        const next = wanted.slice(0, 20);
        if (next.length !== current.length) {
          await deps.target.setHubs(actor, mapId, next);
          step('settings', current.length === 0 ? 'created' : 'updated');
        } else step('settings', 'unchanged');
        if (wanted.length > next.length)
          warn(`Map hubs: a map keeps at most 20, so ${wanted.length - next.length} were left out`);
      }
    }
    const personal = plan.personalHubs ?? [];
    if (personal.length > 0) {
      if (!hasMapRole(role, 'manager')) step('settings', 'skipped');
      else {
        let unknown = 0;
        for (const user of personal) {
          const outcome = await deps.target.addPersonalHubs(user.characterId, user.hubs);
          if (outcome === 'no-account') unknown++;
          step('settings', outcome === 'no-account' ? 'skipped' : outcome);
        }
        if (unknown > 0)
          warn(
            `Users' own hubs: ${unknown} of ${personal.length} Wanderer ${personal.length === 1 ? 'user has' : 'users have'} no Darkbeacon account with their main character linked yet`,
          );
      }
    }
    if (plan.description) await this.description(actor, mapId, plan.description, links, r, role, step);
    if (plan.webhooks.length > 0) await this.webhooks(actor, mapId, plan, links, r, role, step, warn);
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

  /**
   * The map's description: a new map takes Wanderer's; an existing one takes it when it has none
   * or still has what an earlier import wrote (it was not changed here since).
   */
  private async description(
    actor: Actor,
    mapId: string,
    description: string,
    links: LinkIndex,
    r: ImportJobRecord,
    role: MapRole | null,
    step: (kind: 'settings', what: 'created' | 'updated' | 'unchanged' | 'skipped') => void,
  ): Promise<void> {
    const { deps } = this;
    const key = sourceKey(r.source);
    const map = await deps.target.map(actor, mapId);
    const base = links.get('setting', 'description')?.written;
    const ours = map.description === '' || (typeof base === 'string' && base === map.description);
    if (map.description === description) step('settings', 'unchanged');
    else if (!hasMapRole(role, 'admin') || !ours) step('settings', 'skipped');
    else {
      await deps.target.setDescription(actor, mapId, description);
      step('settings', map.description === '' ? 'created' : 'updated');
    }
    if (ours) await this.link(mapId, key, 'setting', 'description', 'description', description, null);
  }

  /**
   * Webhook subscriptions, added switched off once per Wanderer subscription: Darkbeacon signs with
   * its own secret and sends its own event shapes, so an admin switches them on when the receiver
   * is ready. One removed here is not added again.
   */
  private async webhooks(
    actor: Actor,
    mapId: string,
    plan: ImportPlan,
    links: LinkIndex,
    r: ImportJobRecord,
    role: MapRole | null,
    step: (kind: 'settings', what: 'created' | 'updated' | 'unchanged' | 'skipped') => void,
    warn: (message: string) => void,
  ): Promise<void> {
    const { deps } = this;
    const key = sourceKey(r.source);
    if (!hasMapRole(role, 'admin')) {
      warn('Webhooks need a map admin; they were left out');
      for (let i = 0; i < plan.webhooks.length; i++) step('settings', 'skipped');
      return;
    }
    let added = 0;
    for (const hook of plan.webhooks) {
      if (links.get('webhook', hook.key)) {
        step('settings', 'unchanged');
        continue;
      }
      const id = await deps.webhooks.addDisabled(actor, mapId, { url: hook.url, events: hook.events });
      await this.link(mapId, key, 'webhook', hook.key, id, { events: hook.events }, null);
      step('settings', 'created');
      added++;
    }
    if (added > 0)
      warn(
        `${added === 1 ? 'A webhook was' : `${added} webhooks were`} added switched off: switch ${added === 1 ? 'it' : 'them'} on in Map settings, Webhooks, once the receiver expects Darkbeacon's events and secret`,
      );
  }

  /**
   * Removes what came from Wanderer, is gone there (deleted, or replaced by a re-scan under a new
   * id) and was not changed here since; `signaturesOnly` for a sync's pull without removals asked.
   */
  private async removals(
    actor: Actor,
    mapId: string,
    key: string,
    plan: ImportPlan,
    links: LinkIndex,
    job: JobProgress,
    step: (kind: 'systems' | 'connections' | 'signatures', what: 'removed' | 'skipped') => void,
    { signaturesOnly }: { signaturesOnly: boolean },
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
    if (signaturesOnly) {
      await job.step(0);
      return;
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

/**
 * Whether Wanderer saw an unchanged signature after the map did: pasted again there (a later
 * `updated_at`) or added again under the same code (a later `inserted_at`).
 */
function seenSince(
  planned: Pick<PlannedSignature, 'createdAt' | 'seenAt'>,
  here: Pick<SignatureDto, 'createdAt' | 'updatedAt'>,
  now: number,
): boolean {
  if (planned.seenAt === null) return false;
  return (
    Math.min(planned.seenAt, now) > here.updatedAt ||
    (planned.createdAt !== null && Math.min(planned.createdAt, now) > here.createdAt)
  );
}
