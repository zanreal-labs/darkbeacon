import { join, resolve } from 'node:path';
import {
  BackupService,
  DEFAULT_BACKUP_SETTINGS,
  parseInterval,
  type BackupNotifier,
  type BackupSettings,
  type Maintenance,
} from '@darkbeacon/backups';
import type { Clock, EventLog } from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import { ConfigError } from '../../config/config.js';
import { FileBackupLock } from './file-lock.js';
import { FileBackupStorage } from './file-backup-storage.js';
import { FileBackupStateStore } from './file-state-store.js';
import { GzipBackupArchive } from './gzip-archive.js';
import { SqliteLiveDatabase } from './sqlite-live-database.js';

export { HttpBackupNotifier } from './backup-notifier.js';

const MB = 1024 * 1024;

export interface BackupConfig {
  /** `BACKUP_DIR`, default `<DATA_DIR>/backups`. */
  dir: string;
  /** Settings from the environment, before the admin tab overrides any. */
  defaults: BackupSettings;
  maxUploadBytes: number;
  maxDatabaseBytes: number;
}

function positive(env: NodeJS.ProcessEnv, key: string, fallback: number | null): number | null {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (/^(off|none|0)$/i.test(raw) && fallback === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ConfigError(`${key}: must be a positive whole number`);
  return value;
}

/** Backup settings from the environment (`BACKUP_*`); see docs/backups.md. */
export function backupConfig(env: NodeJS.ProcessEnv, dataDir: string): BackupConfig {
  let intervalMinutes = DEFAULT_BACKUP_SETTINGS.intervalMinutes;
  const schedule = env.BACKUP_SCHEDULE?.trim();
  if (schedule) {
    try {
      intervalMinutes = parseInterval(schedule);
    } catch (error) {
      throw new ConfigError(`BACKUP_SCHEDULE: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const notifyUrl = env.BACKUP_NOTIFY_URL?.trim() || null;
  if (notifyUrl && !/^https?:\/\/\S+$/i.test(notifyUrl)) {
    throw new ConfigError('BACKUP_NOTIFY_URL: must be an http(s) address');
  }
  const uploadMb = positive(env, 'BACKUP_MAX_UPLOAD_MB', 1024)!;
  return {
    dir: resolve(env.BACKUP_DIR?.trim() || join(dataDir, 'backups')),
    defaults: {
      intervalMinutes,
      keep: positive(env, 'BACKUP_RETENTION', DEFAULT_BACKUP_SETTINGS.keep)!,
      maxAgeDays: positive(env, 'BACKUP_MAX_AGE_DAYS', null),
      notifyUrl,
      notifySuccess: false,
    },
    maxUploadBytes: uploadMb * MB,
    maxDatabaseBytes: uploadMb * MB * 10,
  };
}

/** Where uploads and packed files wait: inside the backup directory, so moving them is a rename. */
export function scratchDirOf(config: BackupConfig): string {
  return join(config.dir, '.tmp');
}

export interface BackupWiring {
  config: BackupConfig;
  database: Database;
  clock: Clock;
  appVersion: string;
  events: EventLog | null;
  maintenance: Maintenance;
  notifier: BackupNotifier;
  onError: (error: unknown) => void;
  /** The CLI's `--force`. */
  forceLock?: boolean;
  /** The CLI: the server may be writing from another process. */
  separateProcess?: boolean;
}

/** The backup use cases over the file system adapters (the server, the startup hook and the CLI). */
export function createBackupService(w: BackupWiring): BackupService {
  const scratch = scratchDirOf(w.config);
  const staging =
    w.database.sqlite && !w.database.sqlite.inMemory ? resolve(w.database.sqlite.filename, '..') : scratch;
  return new BackupService({
    live: new SqliteLiveDatabase(w.database, scratch),
    archive: new GzipBackupArchive(scratch, staging),
    storage: new FileBackupStorage(w.config.dir),
    state: new FileBackupStateStore(join(w.config.dir, 'backups.json')),
    lock: new FileBackupLock(w.config.dir, () => w.clock.now(), w.forceLock ?? false),
    maintenance: w.maintenance,
    notifier: w.notifier,
    events: w.events,
    clock: w.clock,
    appVersion: w.appVersion,
    defaults: w.config.defaults,
    maxUploadBytes: w.config.maxUploadBytes,
    maxDatabaseBytes: w.config.maxDatabaseBytes,
    onError: w.onError,
  });
}

/** Maintenance for when nothing else runs (startup, the CLI). */
export const noMaintenance: Maintenance = {
  enter: () => Promise.resolve(),
  leave: () => Promise.resolve(),
};

export const noNotifier: BackupNotifier = { send: () => Promise.resolve() };
