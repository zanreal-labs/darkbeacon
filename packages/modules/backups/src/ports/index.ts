import type { BackupManifest } from '../domain/backup.js';
import type { BackupState } from '../domain/settings.js';
import type { DatabaseInspection } from '../domain/validation.js';

export type { Clock, EventLog } from '@darkbeacon/core';

/** A file on the local disk the caller owns until it calls `dispose` (removes it, if temporary). */
export interface LocalFile {
  readonly path: string;
  dispose(): Promise<void>;
}

/** Bytes as they stream out of storage (a Node Readable is one). */
export type ByteStream = AsyncIterable<Uint8Array>;

/** The running database. */
export interface LiveDatabase {
  readonly dialect: 'sqlite' | 'postgres';
  /** False on Postgres and for in-memory SQLite: nothing to back up here. */
  readonly supported: boolean;
  /** A consistent copy of the running database, taken without stopping anything. */
  snapshot(): Promise<LocalFile>;
  /** Migrations this code ships. */
  knownMigrations(): Promise<string[]>;
  /**
   * Swaps `file` in: every query waits, the handle closes, the file is replaced atomically
   * (stale `-wal`/`-shm` removed), the handle reopens and pending migrations run, then the new
   * file is checked. When any step fails the previous file is put back and the error rethrown.
   * Returns the migrations that ran.
   */
  replace(file: LocalFile): Promise<string[]>;
}

/** Packing (gzip + SHA-256) and reading database files. */
export interface BackupArchive {
  pack(database: LocalFile): Promise<{ file: LocalFile; size: number; databaseSize: number; sha256: string }>;
  /**
   * A plain database file next to the live one, from a backup (gzip) or a plain SQLite file.
   * Refuses anything bigger than `maxBytes` once unpacked, and anything else entirely.
   */
  unpack(file: LocalFile, maxBytes: number): Promise<LocalFile>;
  inspect(database: LocalFile, options?: { quick?: boolean }): Promise<DatabaseInspection>;
}

/**
 * Where backups are kept. The file system next to the data today; an S3-compatible bucket can
 * implement the same port later (list manifests, put, get, delete).
 */
export interface BackupStorage {
  /** Where backups go, for people (a path or a bucket URL). */
  readonly location: string;
  list(): Promise<BackupManifest[]>;
  get(name: string): Promise<BackupManifest | null>;
  /** Stores a packed backup under `manifest.name`, atomically; consumes `packed`. */
  put(manifest: BackupManifest, packed: LocalFile): Promise<void>;
  /** A local copy to restore from (the file itself for local storage). */
  fetch(name: string): Promise<LocalFile>;
  read(name: string): Promise<ByteStream>;
  remove(name: string): Promise<boolean>;
}

/** The module's own state (settings, last outcomes), kept outside the database. */
export interface BackupStateStore {
  load(): Promise<BackupState>;
  save(state: BackupState): Promise<void>;
}

/** One backup or restore at a time, also across processes (the CLI next to the server). */
export interface BackupLock {
  /** Throws ConflictError when something else holds it. Returns the release function. */
  acquire(operation: 'backup' | 'restore'): Promise<() => Promise<void>>;
  /** What holds it right now, if anything. */
  current(): Promise<{ operation: 'backup' | 'restore'; startedAt: number } | null>;
}

/** Keeps the rest of the server out of the way while the database is replaced. */
export interface Maintenance {
  /** Rejects writes, waits for work in flight and pauses background jobs. */
  enter(reason: string): Promise<void>;
  /**
   * Resumes everything; with `restored`, what the server keeps in memory is reloaded from the
   * (new) database and realtime clients are told to start over.
   */
  leave(restored: boolean): Promise<void>;
}

export interface BackupAlert {
  kind: 'completed' | 'failed' | 'restored';
  title: string;
  body: string;
}

/** Tells admins (the core notifier, an alert webhook) about backups. Never throws. */
export interface BackupNotifier {
  send(alert: BackupAlert, settings: { notifyUrl: string | null; notifySuccess: boolean }): Promise<void>;
}
