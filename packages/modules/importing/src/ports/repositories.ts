import type { AccountActor } from '@darkbeacon/core';
import type {
  ImportAccessEntryDto,
  ImportCountsDto,
  ImportJobStatus,
  ImportMode,
  ImportOutcomeDto,
  ImportReportLineDto,
  ImportSourceDto,
} from '@darkbeacon/shared';
import type { WandererMapDump } from '../domain/wanderer.js';

/** How a started import runs. */
export interface ImportOptions {
  name?: string;
  slug?: string;
  includeAccess: boolean;
  removeMissing: boolean;
  keepSyncing?: { intervalMinutes: number; removeMissing: boolean };
}

/** One import: the source read at preview time, then the job that writes it. */
export interface ImportJobRecord {
  id: string;
  /** Who staged it; the job runs with this account's rights. */
  actor: AccountActor;
  status: ImportJobStatus;
  source: ImportSourceDto;
  mode: ImportMode | null;
  mapId: string | null;
  mapSlug: string | null;
  mapName: string | null;
  phase: string;
  done: number;
  total: number;
  /** What was read from the source; the job translates it again when it runs. */
  dump: WandererMapDump;
  counts: ImportCountsDto;
  report: ImportReportLineDto[];
  access: ImportAccessEntryDto[];
  outcome: Record<string, ImportOutcomeDto>;
  warnings: string[];
  error: string | null;
  options: ImportOptions | null;
  /** Sealed API source (for setting up a sync after the import); null for files. */
  sealedSource: string | null;
  syncId: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface ImportJobRepository {
  insert(job: ImportJobRecord): Promise<void>;
  update(job: ImportJobRecord): Promise<void>;
  find(id: string): Promise<ImportJobRecord | null>;
  /** Queued and running jobs, oldest first (to resume after a restart). */
  listRunnable(): Promise<ImportJobRecord[]>;
  /** Previews never started, staged before `before`, are deleted (they hold whole maps). */
  deletePreviewsBefore(before: number): Promise<number>;
  /** Drops the stored source data of jobs that finished before `before` (keeps the report). */
  forgetDumpsBefore(before: number): Promise<number>;
}

/**
 * What an import wrote, per map, source and object: the stable id in Wanderer, the id here, the
 * values written (the base of the next merge) and Wanderer fields Darkbeacon has no place for.
 */
export interface ImportLinkRecord {
  mapId: string;
  /** `wanderer.ltd/home-chain` or `file/<name>`. */
  sourceKey: string;
  /** system, connection, signature, label, access, setting. */
  kind: string;
  externalId: string;
  localId: string;
  /** The values the import wrote, in Darkbeacon terms. */
  written: unknown;
  /** Wanderer's fields with no Darkbeacon equivalent (`importedExtra`), or null. */
  extra: unknown;
  importedAt: number;
}

export interface ImportLinkRepository {
  list(mapId: string, sourceKey: string, kind?: string): Promise<ImportLinkRecord[]>;
  /** Inserts or replaces (mapId, sourceKey, kind, externalId). */
  save(link: ImportLinkRecord): Promise<void>;
  delete(mapId: string, sourceKey: string, kind: string, externalId: string): Promise<void>;
  forgetMap(mapId: string): Promise<void>;
}

/** A map pulling from a Wanderer map every few minutes. */
export interface ImportSyncRecord {
  id: string;
  mapId: string;
  actor: AccountActor;
  source: ImportSourceDto;
  /** The sealed `WandererApiSourceRequest` (the key never leaves the server). */
  sealedSource: string;
  intervalMinutes: number;
  removeMissing: boolean;
  enabled: boolean;
  lastRunAt: number | null;
  lastJobId: string | null;
  lastError: string | null;
  /** Failed pulls in a row; the sync stops after a few. */
  failures: number;
  nextRunAt: number | null;
  createdAt: number;
}

export interface ImportSyncRepository {
  insert(sync: ImportSyncRecord): Promise<void>;
  update(sync: ImportSyncRecord): Promise<void>;
  find(id: string): Promise<ImportSyncRecord | null>;
  /** The map's sync that is switched on, if any. */
  activeForMap(mapId: string): Promise<ImportSyncRecord | null>;
  /** Switched-on syncs whose next pull is due. */
  due(now: number): Promise<ImportSyncRecord[]>;
  forgetMap(mapId: string): Promise<void>;
}

/** Seals secrets at rest (AES-256-GCM, key derived from SECRET_KEY). */
export interface SecretSealer {
  seal(plain: string): string;
  open(sealed: string): string;
}

/** Instance policy for outgoing requests to Wanderer instances. */
export interface ImportPolicy {
  /** Whether imports may reach private and local networks (and plain http). */
  allowPrivateNetworks(): Promise<boolean>;
}
