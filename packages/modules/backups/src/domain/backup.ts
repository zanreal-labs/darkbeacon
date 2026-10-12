import { BACKUP_NAME_PATTERN, type BackupDto, type BackupTrigger } from '@darkbeacon/shared';

export type { BackupTrigger };

/** The manifest kept next to every backup file. */
export type BackupManifest = BackupDto;

/** Triggers retention may remove; manual backups stay until someone deletes them. */
export const AUTOMATIC_TRIGGERS: readonly BackupTrigger[] = ['scheduled', 'pre-restore', 'pre-migration'];

export function isAutomatic(trigger: BackupTrigger): boolean {
  return AUTOMATIC_TRIGGERS.includes(trigger);
}

/** `20261012T101500Z` for an epoch-ms time (UTC, to the second). */
export function utcStamp(at: number): string {
  return new Date(at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** A version as it may appear in a file name (anything else becomes `_`). */
function safeVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z.+_-]/g, '_').slice(0, 40) || 'unknown';
}

/**
 * `darkbeacon-20261012T101500Z-v0.1.0-s21.db.gz`: when, which app version, which schema version
 * (migrations applied). `taken` are names already in use; a `-1`, `-2`... suffix avoids them.
 */
export function backupName(
  at: number,
  appVersion: string,
  schemaVersion: number,
  taken: ReadonlySet<string> = new Set(),
): string {
  const base = `darkbeacon-${utcStamp(at)}-v${safeVersion(appVersion)}-s${schemaVersion}`;
  let name = `${base}.db.gz`;
  for (let n = 1; taken.has(name); n++) name = `${base}-${n}.db.gz`;
  return name;
}

/** Names are checked before they reach storage: no paths, no other files. */
export function isBackupName(name: string): boolean {
  return BACKUP_NAME_PATTERN.test(name);
}

export function newestFirst(backups: readonly BackupManifest[]): BackupManifest[] {
  return [...backups].sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}
