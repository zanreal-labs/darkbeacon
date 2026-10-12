import {
  AUDIT_STREAM,
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
  actorRef,
  isDomainError,
  newEvent,
  requireInstanceRole,
  type Actor,
  type ActorRef,
  type Clock,
  type EventLog,
} from '@darkbeacon/core';
import {
  RESTORE_CONFIRMATION,
  type AuditEventPayloads,
  type AuditEventType,
  type BackupStatusDto,
  type BackupTrigger,
  type RestoreResultDto,
  type UpdateBackupSettingsRequest,
} from '@darkbeacon/shared';
import { backupName, isBackupName, newestFirst, type BackupManifest } from '../domain/backup.js';
import { backupsToPrune } from '../domain/retention.js';
import { isDue, nextRunAt } from '../domain/schedule.js';
import {
  effectiveSettings,
  isFailing,
  settingsDto,
  type BackupOutcome,
  type BackupSettings,
  type BackupState,
} from '../domain/settings.js';
import { assertRestorable } from '../domain/validation.js';
import type {
  BackupArchive,
  BackupLock,
  BackupNotifier,
  BackupStateStore,
  BackupStorage,
  ByteStream,
  LiveDatabase,
  LocalFile,
  Maintenance,
} from '../ports/index.js';

export interface BackupServiceDeps {
  live: LiveDatabase;
  archive: BackupArchive;
  storage: BackupStorage;
  state: BackupStateStore;
  lock: BackupLock;
  maintenance: Maintenance;
  notifier: BackupNotifier;
  /** Backups and restores are recorded on the audit stream; null before migrations ran. */
  events: EventLog | null;
  clock: Clock;
  appVersion: string;
  /** Settings from the environment; the admin tab overrides them. */
  defaults: BackupSettings;
  /** Largest upload accepted, and the largest database unpacked from anything. */
  maxUploadBytes: number;
  maxDatabaseBytes: number;
  /** Problems that must not fail the operation (an audit append, a notification). */
  onError?: (error: unknown) => void;
}

const SYSTEM: ActorRef = { kind: 'system', id: 'backups' };

/**
 * Instance admins, and system processes of the server itself (the CLI run inside the container).
 * HTTP never resolves to a system actor.
 */
function requireOperator(actor: Actor | null): ActorRef {
  if (actor?.kind === 'system') return actorRef(actor);
  return actorRef(requireInstanceRole(actor, 'admin'));
}

type RestoreSource = { name: string; source: 'backup' | 'upload' };

/**
 * Backups of the SQLite database: made by hand, on a schedule, before migrations and before
 * every restore; listed, downloaded, deleted, pruned; restored from the list or an upload.
 * One operation at a time (`BackupLock`). Instance admins only.
 */
export class BackupService {
  private readonly onError: (error: unknown) => void;

  constructor(private readonly deps: BackupServiceDeps) {
    this.onError = deps.onError ?? (() => undefined);
  }

  get supported(): boolean {
    return this.deps.live.supported;
  }

  async status(actor: Actor | null): Promise<BackupStatusDto> {
    requireOperator(actor);
    const { live, storage, clock } = this.deps;
    const state = await this.deps.state.load();
    const settings = effectiveSettings(this.deps.defaults, state);
    const now = clock.now();
    return {
      supported: live.supported,
      database: live.dialect,
      directory: storage.location,
      settings: settingsDto(settings),
      running: live.supported ? await this.deps.lock.current() : null,
      lastSuccess: state.lastSuccess,
      lastFailure: state.lastFailure,
      failing: isFailing(state),
      lastRestore: state.lastRestore,
      nextRunAt: live.supported ? nextRunAt(this.schedule(state, settings), now) : null,
      maxUploadBytes: this.deps.maxUploadBytes,
      backups: live.supported ? newestFirst(await storage.list()) : [],
    };
  }

  /** "Back up now". */
  async create(actor: Actor | null): Promise<BackupManifest> {
    const operator = requireOperator(actor);
    this.requireSupported();
    return this.locked('backup', () => this.backup('manual', operator));
  }

  /**
   * Runs the scheduled backup when it is due. Returns null when it is not, or when another
   * backup or restore is running (the next tick tries again).
   */
  async runScheduled(): Promise<BackupManifest | null> {
    if (!this.supported) return null;
    const state = await this.deps.state.load();
    const settings = effectiveSettings(this.deps.defaults, state);
    const now = this.deps.clock.now();
    if (!isDue(this.schedule(state, settings), now)) return null;
    let release: () => Promise<void>;
    try {
      release = await this.deps.lock.acquire('backup');
    } catch (error) {
      if (error instanceof ConflictError) return null;
      throw error;
    }
    try {
      await this.updateState((s) => ({ ...s, lastScheduledAt: now, lastScheduledFailed: false }));
      try {
        return await this.backup('scheduled', SYSTEM);
      } catch (error) {
        await this.updateState((s) => ({ ...s, lastScheduledFailed: true }));
        throw error;
      }
    } finally {
      await release();
    }
  }

  /** At startup, before pending migrations run on an existing database. */
  async backupBeforeMigration(): Promise<BackupManifest | null> {
    if (!this.supported) return null;
    return this.locked('backup', () => this.backup('pre-migration', SYSTEM));
  }

  async remove(actor: Actor | null, name: string): Promise<void> {
    const admin = requireInstanceRole(actor, 'admin');
    this.requireSupported();
    if (!isBackupName(name)) throw new NotFoundError('Backup');
    await this.locked('backup', async () => {
      if (!(await this.deps.storage.remove(name))) throw new NotFoundError('Backup');
    });
    await this.audit(actorRef(admin), 'backup.deleted', { name });
  }

  /** The file to stream to an admin; the download is recorded. */
  async download(
    actor: Actor | null,
    name: string,
  ): Promise<{ manifest: BackupManifest; stream: ByteStream }> {
    const admin = requireInstanceRole(actor, 'admin');
    this.requireSupported();
    const manifest = isBackupName(name) ? await this.deps.storage.get(name) : null;
    if (!manifest) throw new NotFoundError('Backup');
    const stream = await this.deps.storage.read(name);
    await this.audit(actorRef(admin), 'backup.downloaded', { name });
    return { manifest, stream };
  }

  async updateSettings(actor: Actor | null, patch: UpdateBackupSettingsRequest) {
    const admin = requireInstanceRole(actor, 'admin');
    if (patch.notifyUrl && !/^https?:\/\//i.test(patch.notifyUrl)) {
      throw new ValidationError('The alert webhook must be an http(s) address');
    }
    let before!: BackupSettings;
    let after!: BackupSettings;
    await this.updateState((state) => {
      before = effectiveSettings(this.deps.defaults, state);
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<BackupSettings>;
      const next = { ...state, settings: { ...state.settings, ...changes } };
      after = effectiveSettings(this.deps.defaults, next);
      return next;
    });
    const dto = settingsDto(after);
    if (JSON.stringify(settingsDto(before)) !== JSON.stringify(dto) || before.notifyUrl !== after.notifyUrl) {
      await this.audit(actorRef(admin), 'backup.settings_changed', dto, settingsDto(before));
    }
    return dto;
  }

  /** Restores a backup from the list. */
  async restore(actor: Actor | null, name: string, confirm: unknown): Promise<RestoreResultDto> {
    const operator = requireOperator(actor);
    this.requireSupported();
    requireConfirmation(confirm);
    if (!isBackupName(name)) throw new NotFoundError('Backup');
    return this.locked('restore', async () => {
      if (!(await this.deps.storage.get(name))) throw new NotFoundError('Backup');
      const fetched = await this.deps.storage.fetch(name);
      let staged: LocalFile;
      try {
        staged = await this.unpack(fetched);
      } finally {
        await fetched.dispose();
      }
      return this.restoreLocked(operator, staged, { name, source: 'backup' });
    });
  }

  /** Restores an uploaded file (a `.db.gz` backup or a plain SQLite file); consumes `upload`. */
  async restoreUpload(actor: Actor | null, upload: LocalFile, confirm: unknown): Promise<RestoreResultDto> {
    let admin: ActorRef;
    try {
      admin = requireOperator(actor);
      this.requireSupported();
      requireConfirmation(confirm);
    } catch (error) {
      await upload.dispose();
      throw error;
    }
    return this.locked('restore', async () => {
      let staged: LocalFile;
      try {
        staged = await this.unpack(upload);
      } catch (error) {
        await this.audit(admin, 'backup.failed', {
          operation: 'restore',
          trigger: null,
          name: 'upload',
          message: message(error),
        });
        throw error;
      } finally {
        await upload.dispose();
      }
      return this.restoreLocked(admin, staged, { name: 'upload', source: 'upload' });
    });
  }

  // ---- internals ----------------------------------------------------------------------------

  private schedule(state: BackupState, settings: BackupSettings) {
    return {
      intervalMinutes: settings.intervalMinutes,
      lastScheduledAt: state.lastScheduledAt,
      lastScheduledFailed: state.lastScheduledFailed,
    };
  }

  private requireSupported(): void {
    if (!this.supported) {
      throw new ConflictError(
        this.deps.live.dialect === 'postgres'
          ? 'This instance runs on PostgreSQL: back it up with pg_dump (see docs/backups.md)'
          : 'Backups need a database file (this one is in memory)',
      );
    }
  }

  private async locked<T>(operation: 'backup' | 'restore', work: () => Promise<T>): Promise<T> {
    const release = await this.deps.lock.acquire(operation);
    try {
      return await work();
    } finally {
      await release();
    }
  }

  /** Makes one backup; the caller holds the lock. */
  private async backup(trigger: BackupTrigger, actor: ActorRef): Promise<BackupManifest> {
    const { live, archive, storage, clock, appVersion } = this.deps;
    const startedAt = clock.now();
    const temporary: LocalFile[] = [];
    try {
      const snapshot = await live.snapshot();
      temporary.push(snapshot);
      const inspection = await archive.inspect(snapshot, { quick: true });
      if (inspection.integrity.length !== 1 || inspection.integrity[0] !== 'ok') {
        throw new Error(
          `the copy failed its integrity check: ${inspection.integrity.slice(0, 3).join('; ')}`,
        );
      }
      const packed = await archive.pack(snapshot);
      temporary.push(packed.file);
      const taken = new Set((await storage.list()).map((b) => b.name));
      const manifest: BackupManifest = {
        name: backupName(startedAt, appVersion, inspection.migrations.length, taken),
        createdAt: startedAt,
        size: packed.size,
        databaseSize: packed.databaseSize,
        sha256: packed.sha256,
        appVersion,
        schemaVersion: inspection.migrations.length,
        trigger,
      };
      await storage.put(manifest, packed.file);
      await this.prune().catch(this.onError);
      const outcome: BackupOutcome = {
        at: clock.now(),
        operation: 'backup',
        trigger,
        name: manifest.name,
        message: null,
      };
      await this.updateState((s) => ({ ...s, lastSuccess: outcome }));
      await this.audit(actor, 'backup.completed', {
        name: manifest.name,
        trigger,
        size: manifest.size,
        schemaVersion: manifest.schemaVersion,
      });
      await this.notify({
        kind: 'completed',
        title: 'Backup made',
        body: `${manifest.name} (${trigger}, ${formatBytes(manifest.size)})`,
      });
      return manifest;
    } catch (error) {
      await this.failed('backup', trigger, null, error, actor);
      throw new DomainError('conflict', `The backup failed: ${message(error)}`);
    } finally {
      for (const file of temporary) await file.dispose().catch(this.onError);
    }
  }

  private async unpack(file: LocalFile): Promise<LocalFile> {
    try {
      return await this.deps.archive.unpack(file, this.deps.maxDatabaseBytes);
    } catch (error) {
      if (isDomainError(error)) throw error;
      throw new ValidationError(`This is not a Darkbeacon backup: ${message(error)}`, {
        reason: 'unreadable',
      });
    }
  }

  /** Validates, backs up the current database, swaps, migrates; rolls back on failure. */
  private async restoreLocked(
    actor: ActorRef,
    staged: LocalFile,
    source: RestoreSource,
  ): Promise<RestoreResultDto> {
    const { live, archive, maintenance, clock } = this.deps;
    try {
      let inspection;
      try {
        inspection = await archive.inspect(staged);
      } catch (error) {
        throw new ValidationError(`This is not a Darkbeacon backup: ${message(error)}`, {
          reason: 'unreadable',
        });
      }
      assertRestorable(inspection, await live.knownMigrations());
    } catch (error) {
      await staged.dispose();
      // A refused file changes nothing, so it is recorded but does not count as failing.
      await this.audit(actor, 'backup.failed', {
        operation: 'restore',
        trigger: null,
        name: source.name,
        message: message(error),
      });
      throw error;
    }

    let preRestore: BackupManifest;
    let applied: string[];
    await maintenance.enter(`restoring ${source.name}`);
    try {
      preRestore = await this.backup('pre-restore', actor);
      applied = await live.replace(staged);
    } catch (error) {
      await maintenance.leave(false).catch(this.onError);
      await staged.dispose().catch(this.onError);
      const text = isDomainError(error)
        ? error.message
        : `The restore failed and was rolled back: ${message(error)}`;
      if (!(isDomainError(error) && error.message.startsWith('The backup failed'))) {
        await this.failed('restore', null, source.name, new Error(text), actor);
      }
      throw new DomainError('conflict', text);
    }
    await maintenance.leave(true).catch(this.onError);
    await staged.dispose().catch(this.onError);

    const outcome: BackupOutcome = {
      at: clock.now(),
      operation: 'restore',
      trigger: null,
      name: source.name,
      message: null,
    };
    await this.updateState((s) => ({ ...s, lastRestore: outcome }));
    await this.audit(actor, 'backup.restored', {
      name: source.name,
      source: source.source,
      preRestore: preRestore.name,
      migrationsApplied: applied,
    });
    await this.notify({
      kind: 'restored',
      title: 'Backup restored',
      body: `${source.source === 'upload' ? 'An uploaded backup' : source.name} was restored. The database before it is kept as ${preRestore.name}.`,
    });
    return { restored: source.name, preRestore: preRestore.name, migrationsApplied: applied };
  }

  private async failed(
    operation: 'backup' | 'restore',
    trigger: BackupTrigger | null,
    name: string | null,
    error: unknown,
    actor: ActorRef,
  ): Promise<void> {
    const text = message(error);
    const outcome: BackupOutcome = { at: this.deps.clock.now(), operation, trigger, name, message: text };
    await this.updateState((s) => ({ ...s, lastFailure: outcome })).catch(this.onError);
    await this.audit(actor, 'backup.failed', { operation, trigger, name, message: text });
    await this.notify({
      kind: 'failed',
      title: operation === 'restore' ? 'Restore failed' : 'Backup failed',
      body: trigger ? `${text} (${trigger} backup)` : text,
    });
  }

  private async prune(): Promise<void> {
    const state = await this.deps.state.load();
    const settings = effectiveSettings(this.deps.defaults, state);
    const doomed = backupsToPrune(await this.deps.storage.list(), settings, this.deps.clock.now());
    for (const backup of doomed) await this.deps.storage.remove(backup.name);
  }

  private async updateState(change: (state: BackupState) => BackupState): Promise<void> {
    await this.deps.state.save(change(await this.deps.state.load()));
  }

  private async notify(alert: { kind: 'completed' | 'failed' | 'restored'; title: string; body: string }) {
    try {
      const settings = effectiveSettings(this.deps.defaults, await this.deps.state.load());
      await this.deps.notifier.send(alert, settings);
    } catch (error) {
      this.onError(error);
    }
  }

  private async audit<T extends AuditEventType>(
    actor: ActorRef,
    type: T,
    data: AuditEventPayloads[T],
    before?: unknown,
  ): Promise<void> {
    if (!this.deps.events) return;
    try {
      await this.deps.events.append([
        newEvent({
          stream: AUDIT_STREAM,
          type,
          actor,
          data,
          occurredAt: this.deps.clock.now(),
          ...(before === undefined ? {} : { before }),
        }),
      ]);
    } catch (error) {
      this.onError(error);
    }
  }
}

function requireConfirmation(confirm: unknown): void {
  if (confirm !== RESTORE_CONFIRMATION) {
    throw new ValidationError(`Type ${RESTORE_CONFIRMATION} to confirm the restore`, {
      reason: 'unconfirmed',
    });
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
