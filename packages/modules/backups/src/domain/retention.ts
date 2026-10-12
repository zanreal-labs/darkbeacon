import { isAutomatic, newestFirst, type BackupManifest } from './backup.js';

const DAY = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  /** Automatic backups kept, newest first (at least 1). */
  keep: number;
  /** Automatic backups older than this many days go too; null: no age limit. */
  maxAgeDays: number | null;
}

/**
 * The backups retention removes: automatic ones beyond the newest `keep`, and automatic ones
 * older than `maxAgeDays`. Manual backups are never chosen, and the newest automatic backup
 * always stays, so a stopped schedule never ends with no backup at all.
 */
export function backupsToPrune(
  backups: readonly BackupManifest[],
  policy: RetentionPolicy,
  now: number,
): BackupManifest[] {
  const automatic = newestFirst(backups).filter((b) => isAutomatic(b.trigger));
  const keep = Math.max(1, policy.keep);
  const cutoff = policy.maxAgeDays === null ? null : now - policy.maxAgeDays * DAY;
  return automatic.filter((backup, index) => {
    if (index === 0) return false;
    if (index >= keep) return true;
    return cutoff !== null && backup.createdAt < cutoff;
  });
}
