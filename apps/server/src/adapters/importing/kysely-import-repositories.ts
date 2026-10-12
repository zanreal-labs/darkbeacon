import { bool, json, type Database } from '@darkbeacon/db';
import {
  emptyDump,
  type ImportJobRecord,
  type ImportJobRepository,
  type ImportLinkRecord,
  type ImportLinkRepository,
  type ImportSyncRecord,
  type ImportSyncRepository,
  type WandererMapDump,
} from '@darkbeacon/importing';
import type { AccountActor } from '@darkbeacon/core';
import type { ImportJobStatus, ImportMode, ImportSourceDto } from '@darkbeacon/shared';

export interface ImportTables {
  import_job: {
    id: string;
    account_id: string;
    actor: string;
    status: string;
    source: string;
    mode: string | null;
    map_id: string | null;
    map_slug: string | null;
    map_name: string | null;
    phase: string;
    done: number;
    total: number;
    dump: string | null;
    counts: string;
    report: string;
    access: string;
    outcome: string;
    warnings: string;
    error: string | null;
    options: string | null;
    sealed_source: string | null;
    sync_id: string | null;
    created_at: number;
    updated_at: number;
    finished_at: number | null;
  };
  import_link: {
    map_id: string;
    source_key: string;
    kind: string;
    external_id: string;
    local_id: string;
    written: string;
    extra: string | null;
    imported_at: number;
  };
  import_sync: {
    id: string;
    map_id: string;
    actor: string;
    source: string;
    sealed_source: string;
    interval_minutes: number;
    remove_missing: number;
    enabled: number;
    last_run_at: number | null;
    last_job_id: string | null;
    last_error: string | null;
    failures: number;
    next_run_at: number | null;
    created_at: number;
  };
}

type JobRow = ImportTables['import_job'];
type SyncRow = ImportTables['import_sync'];

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export class KyselyImportJobRepository implements ImportJobRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<ImportTables>();
  }

  async insert(job: ImportJobRecord): Promise<void> {
    await this.db.insertInto('import_job').values(toJobRow(job)).execute();
  }

  async update(job: ImportJobRecord): Promise<void> {
    const { id: _id, dump: _dump, created_at: _created, ...row } = toJobRow(job);
    await this.db.updateTable('import_job').set(row).where('id', '=', job.id).execute();
  }

  async find(id: string): Promise<ImportJobRecord | null> {
    const row = await this.db.selectFrom('import_job').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? fromJobRow(row) : null;
  }

  async listRunnable(): Promise<ImportJobRecord[]> {
    const rows = await this.db
      .selectFrom('import_job')
      .selectAll()
      .where('status', 'in', ['queued', 'running'])
      .orderBy('created_at')
      .execute();
    return rows.map(fromJobRow);
  }

  async deletePreviewsBefore(before: number): Promise<number> {
    const result = await this.db
      .deleteFrom('import_job')
      .where('status', 'in', ['preview', 'cancelled'])
      .where('updated_at', '<', before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async forgetDumpsBefore(before: number): Promise<number> {
    const result = await this.db
      .updateTable('import_job')
      .set({ dump: null })
      .where('finished_at', '<', before)
      .where('dump', 'is not', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}

function toJobRow(job: ImportJobRecord): JobRow {
  return {
    id: job.id,
    account_id: job.actor.id,
    actor: json.encode(job.actor),
    status: job.status,
    source: json.encode(job.source),
    mode: job.mode,
    map_id: job.mapId,
    map_slug: job.mapSlug,
    map_name: job.mapName,
    phase: job.phase,
    done: job.done,
    total: job.total,
    dump: json.encode(job.dump),
    counts: json.encode(job.counts),
    report: json.encode(job.report),
    access: json.encode(job.access),
    outcome: json.encode(job.outcome),
    warnings: json.encode(job.warnings),
    error: job.error,
    options: job.options ? json.encode(job.options) : null,
    sealed_source: job.sealedSource,
    sync_id: job.syncId,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
  };
}

function fromJobRow(row: JobRow): ImportJobRecord {
  const source = json.decode<ImportSourceDto>(row.source)!;
  const createdAt = Number(row.created_at);
  return {
    id: row.id,
    actor: json.decode<AccountActor>(row.actor)!,
    status: row.status as ImportJobStatus,
    source,
    mode: row.mode as ImportMode | null,
    mapId: row.map_id,
    mapSlug: row.map_slug,
    mapName: row.map_name,
    phase: row.phase,
    done: Number(row.done),
    total: Number(row.total),
    dump: json.decode<WandererMapDump>(row.dump) ?? emptyDump(source, createdAt),
    counts: json.decode(row.counts)!,
    report: json.decode(row.report)!,
    access: json.decode(row.access)!,
    outcome: json.decode(row.outcome)!,
    warnings: json.decode(row.warnings)!,
    error: row.error,
    options: json.decode(row.options),
    sealedSource: row.sealed_source,
    syncId: row.sync_id,
    createdAt,
    updatedAt: Number(row.updated_at),
    finishedAt: num(row.finished_at),
  };
}

export class KyselyImportLinkRepository implements ImportLinkRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<ImportTables>();
  }

  async list(mapId: string, sourceKey: string, kind?: string): Promise<ImportLinkRecord[]> {
    let query = this.db
      .selectFrom('import_link')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('source_key', '=', sourceKey);
    if (kind) query = query.where('kind', '=', kind);
    const rows = await query.execute();
    return rows.map((row) => ({
      mapId: row.map_id,
      sourceKey: row.source_key,
      kind: row.kind,
      externalId: row.external_id,
      localId: row.local_id,
      written: json.decode(row.written),
      extra: json.decode(row.extra),
      importedAt: Number(row.imported_at),
    }));
  }

  async save(link: ImportLinkRecord): Promise<void> {
    const values = {
      map_id: link.mapId,
      source_key: link.sourceKey,
      kind: link.kind,
      external_id: link.externalId,
      local_id: link.localId,
      written: json.encode(link.written ?? null),
      extra: link.extra === null || link.extra === undefined ? null : json.encode(link.extra),
      imported_at: link.importedAt,
    };
    await this.db
      .insertInto('import_link')
      .values(values)
      .onConflict((oc) =>
        oc.columns(['map_id', 'source_key', 'kind', 'external_id']).doUpdateSet({
          local_id: values.local_id,
          written: values.written,
          extra: values.extra,
          imported_at: values.imported_at,
        }),
      )
      .execute();
  }

  async delete(mapId: string, sourceKey: string, kind: string, externalId: string): Promise<void> {
    await this.db
      .deleteFrom('import_link')
      .where('map_id', '=', mapId)
      .where('source_key', '=', sourceKey)
      .where('kind', '=', kind)
      .where('external_id', '=', externalId)
      .execute();
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('import_link').where('map_id', '=', mapId).execute();
  }
}

export class KyselyImportSyncRepository implements ImportSyncRepository {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db<ImportTables>();
  }

  async insert(sync: ImportSyncRecord): Promise<void> {
    await this.db.insertInto('import_sync').values(toSyncRow(sync)).execute();
  }

  async update(sync: ImportSyncRecord): Promise<void> {
    const { id: _id, ...row } = toSyncRow(sync);
    await this.db.updateTable('import_sync').set(row).where('id', '=', sync.id).execute();
  }

  async find(id: string): Promise<ImportSyncRecord | null> {
    const row = await this.db.selectFrom('import_sync').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? fromSyncRow(row) : null;
  }

  async activeForMap(mapId: string): Promise<ImportSyncRecord | null> {
    const row = await this.db
      .selectFrom('import_sync')
      .selectAll()
      .where('map_id', '=', mapId)
      .where('enabled', '=', 1)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return row ? fromSyncRow(row) : null;
  }

  async due(now: number): Promise<ImportSyncRecord[]> {
    const rows = await this.db
      .selectFrom('import_sync')
      .selectAll()
      .where('enabled', '=', 1)
      .where('next_run_at', '<=', now)
      .orderBy('next_run_at')
      .execute();
    return rows.map(fromSyncRow);
  }

  async forgetMap(mapId: string): Promise<void> {
    await this.db.deleteFrom('import_sync').where('map_id', '=', mapId).execute();
  }
}

function toSyncRow(sync: ImportSyncRecord): SyncRow {
  return {
    id: sync.id,
    map_id: sync.mapId,
    actor: json.encode(sync.actor),
    source: json.encode(sync.source),
    sealed_source: sync.sealedSource,
    interval_minutes: sync.intervalMinutes,
    remove_missing: bool.encode(sync.removeMissing),
    enabled: bool.encode(sync.enabled),
    last_run_at: sync.lastRunAt,
    last_job_id: sync.lastJobId,
    last_error: sync.lastError,
    failures: sync.failures,
    next_run_at: sync.nextRunAt,
    created_at: sync.createdAt,
  };
}

function fromSyncRow(row: SyncRow): ImportSyncRecord {
  return {
    id: row.id,
    mapId: row.map_id,
    actor: json.decode<AccountActor>(row.actor)!,
    source: json.decode<ImportSourceDto>(row.source)!,
    sealedSource: row.sealed_source,
    intervalMinutes: Number(row.interval_minutes),
    removeMissing: bool.decode(row.remove_missing),
    enabled: bool.decode(row.enabled),
    lastRunAt: num(row.last_run_at),
    lastJobId: row.last_job_id,
    lastError: row.last_error,
    failures: Number(row.failures),
    nextRunAt: num(row.next_run_at),
    createdAt: Number(row.created_at),
  };
}
