import { z } from 'zod';
import { Timestamp } from './common.js';

/** Why a backup was made. Manual backups are never removed by retention. */
export const BackupTrigger = z.enum(['manual', 'scheduled', 'pre-restore', 'pre-migration']);
export type BackupTrigger = z.infer<typeof BackupTrigger>;

/**
 * File names of backups: `darkbeacon-<UTC stamp>-v<app version>-s<schema version>.db.gz`, with a
 * `-<n>` suffix when two land in the same second. Anything else is refused (no paths).
 */
export const BACKUP_NAME_PATTERN =
  /^darkbeacon-\d{8}T\d{6}Z-v[0-9A-Za-z.+_-]{1,40}-s\d{1,5}(-\d{1,3})?\.db\.gz$/;
export const BackupName = z.string().regex(BACKUP_NAME_PATTERN, 'not a backup file name');

/** The manifest stored next to every backup (`<name>.json`). */
export const BackupDto = z.object({
  name: z.string(),
  createdAt: Timestamp,
  /** Bytes of the compressed file. */
  size: z.number().int().nonnegative(),
  /** Bytes of the database inside. */
  databaseSize: z.number().int().nonnegative(),
  /** Hex SHA-256 of the compressed file. */
  sha256: z.string(),
  appVersion: z.string(),
  /** Number of migrations applied in the backed-up database. */
  schemaVersion: z.number().int().nonnegative(),
  trigger: BackupTrigger,
});
export type BackupDto = z.infer<typeof BackupDto>;

export const BackupSettingsDto = z.object({
  /** Minutes between scheduled backups; null: no schedule. */
  intervalMinutes: z.number().int().positive().nullable(),
  /** Automatic backups kept (scheduled, pre-restore, pre-migration); manual ones are never removed. */
  keep: z.number().int().min(1),
  /** Automatic backups older than this are removed too (the newest one always stays). */
  maxAgeDays: z.number().int().positive().nullable(),
  /** Host of the alert webhook (the address itself is a secret and never shown); null: none. */
  notifyHost: z.string().nullable(),
  /** Post successful backups to the alert webhook too, not only failures and restores. */
  notifySuccess: z.boolean(),
});
export type BackupSettingsDto = z.infer<typeof BackupSettingsDto>;

export const UpdateBackupSettingsRequest = z.object({
  intervalMinutes: z
    .number()
    .int()
    .min(15)
    .max(60 * 24 * 30)
    .nullable()
    .optional(),
  keep: z.number().int().min(1).max(1000).optional(),
  maxAgeDays: z.number().int().min(1).max(3650).nullable().optional(),
  /** A Discord webhook or any http(s) endpoint; null removes it. */
  notifyUrl: z.url().max(500).nullable().optional(),
  notifySuccess: z.boolean().optional(),
});
export type UpdateBackupSettingsRequest = z.infer<typeof UpdateBackupSettingsRequest>;

export const BackupOutcomeDto = z.object({
  at: Timestamp,
  operation: z.enum(['backup', 'restore']),
  trigger: BackupTrigger.nullable(),
  /** The backup made or restored. */
  name: z.string().nullable(),
  /** Why it failed (failures only). */
  message: z.string().nullable(),
});
export type BackupOutcomeDto = z.infer<typeof BackupOutcomeDto>;

/** GET /api/admin/backups: everything the Backups section shows. */
export const BackupStatusDto = z.object({
  /** False on Postgres: backups are made with Postgres tooling (pg_dump). */
  supported: z.boolean(),
  database: z.enum(['sqlite', 'postgres']),
  /** Where backups are kept inside the container. */
  directory: z.string(),
  settings: BackupSettingsDto,
  running: z.object({ operation: z.enum(['backup', 'restore']), startedAt: Timestamp }).nullable(),
  lastSuccess: BackupOutcomeDto.nullable(),
  lastFailure: BackupOutcomeDto.nullable(),
  /** The last failure is newer than the last success: something needs looking at. */
  failing: z.boolean(),
  lastRestore: BackupOutcomeDto.nullable(),
  nextRunAt: Timestamp.nullable(),
  /** Largest file accepted by an upload restore. */
  maxUploadBytes: z.number().int().positive(),
  backups: z.array(BackupDto),
});
export type BackupStatusDto = z.infer<typeof BackupStatusDto>;

/** What has to be typed to confirm a restore (in the UI and in API calls). */
export const RESTORE_CONFIRMATION = 'RESTORE';

export const RestoreBackupRequest = z.object({
  confirm: z.literal(RESTORE_CONFIRMATION, { error: `type ${RESTORE_CONFIRMATION} to confirm` }),
});
export type RestoreBackupRequest = z.infer<typeof RestoreBackupRequest>;

export const RestoreResultDto = z.object({
  /** The backup restored, or `upload`. */
  restored: z.string(),
  /** The backup of the database as it was right before. */
  preRestore: z.string(),
  /** Migrations run on the restored database (it came from an older version). */
  migrationsApplied: z.array(z.string()),
});
export type RestoreResultDto = z.infer<typeof RestoreResultDto>;
