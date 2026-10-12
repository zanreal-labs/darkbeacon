import type { ImportAccessEntryDto, ImportJobDto, ImportSourceDto, ImportSyncDto } from '@darkbeacon/shared';
import type { PlannedAccessRule } from '../domain/acl.js';
import type { ImportJobRecord, ImportSyncRecord } from '../ports/repositories.js';
import type { EveName } from '../ports/target.js';

/** `wanderer.ltd/home-chain`: the key links of one source are kept under. */
export function sourceKey(source: ImportSourceDto): string {
  return `${source.host}/${source.slug}`;
}

/**
 * The audit channel of an import's changes: a system process named after its source, so every
 * change reads "imported from Wanderer <host>/<slug>" in the histories.
 */
export function auditChannel(source: ImportSourceDto): { kind: 'system'; id: string } {
  return { kind: 'system', id: `wanderer:${sourceKey(source)}` };
}

export function importStream(jobId: string): string {
  return `import:${jobId}`;
}

export function toJobDto(job: ImportJobRecord): ImportJobDto {
  return {
    id: job.id,
    status: job.status,
    source: job.source,
    mode: job.mode,
    mapId: job.mapId,
    mapSlug: job.mapSlug,
    mapName: job.mapName,
    phase: job.phase,
    done: job.done,
    total: job.total,
    counts: job.counts,
    report: job.report,
    access: job.access,
    outcome: job.outcome,
    warnings: job.warnings,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    syncId: job.syncId,
  };
}

export function toSyncDto(sync: ImportSyncRecord): ImportSyncDto {
  return {
    id: sync.id,
    mapId: sync.mapId,
    source: sync.source,
    intervalMinutes: sync.intervalMinutes,
    removeMissing: sync.removeMissing,
    accountId: sync.actor.id,
    enabled: sync.enabled,
    lastRunAt: sync.lastRunAt,
    lastJobId: sync.lastJobId,
    lastError: sync.lastError,
    nextRunAt: sync.enabled ? sync.nextRunAt : null,
    createdAt: sync.createdAt,
  };
}

/** The access plan as the preview shows it, with the names ESI gives today. */
export function accessEntries(
  rules: readonly PlannedAccessRule[],
  names: ReadonlyMap<number, EveName>,
): ImportAccessEntryDto[] {
  return rules.map((rule) => {
    const esi = names.get(Number(rule.subjectId));
    const mismatch = esi && esi.category !== rule.subjectKind;
    return {
      subjectKind: rule.subjectKind,
      subjectId: rule.subjectId,
      wandererName: rule.wandererName,
      esiName: esi && !mismatch ? esi.name : null,
      ticker: esi && !mismatch ? esi.ticker : null,
      wandererRole: rule.wandererRole,
      role: rule.role,
      acls: rule.acls,
      note: mismatch ? `ESI says this id is a ${esi.category}, not a ${rule.subjectKind}` : rule.note,
    };
  });
}
