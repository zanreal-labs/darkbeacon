import type { BackupOutcomeDto, BackupSettingsDto } from '@darkbeacon/shared';

/** Settings as stored: like the DTO, with the alert webhook address itself. */
export interface BackupSettings {
  intervalMinutes: number | null;
  keep: number;
  maxAgeDays: number | null;
  notifyUrl: string | null;
  notifySuccess: boolean;
}

/** Without any configuration: a daily backup, the 14 newest automatic ones kept. */
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  intervalMinutes: 24 * 60,
  keep: 14,
  maxAgeDays: null,
  notifyUrl: null,
  notifySuccess: false,
};

export type BackupOutcome = BackupOutcomeDto;

/**
 * What the module remembers between runs. It is kept next to the backups, not in the database:
 * a restore replaces the database and must neither change the schedule nor forget a failure.
 */
export interface BackupState {
  /** Settings changed in the admin tab; missing keys fall back to the environment defaults. */
  settings: Partial<BackupSettings>;
  lastScheduledAt: number | null;
  lastScheduledFailed: boolean;
  lastSuccess: BackupOutcome | null;
  lastFailure: BackupOutcome | null;
  lastRestore: BackupOutcome | null;
}

export const EMPTY_BACKUP_STATE: BackupState = {
  settings: {},
  lastScheduledAt: null,
  lastScheduledFailed: false,
  lastSuccess: null,
  lastFailure: null,
  lastRestore: null,
};

export function effectiveSettings(defaults: BackupSettings, state: BackupState): BackupSettings {
  return { ...defaults, ...state.settings };
}

/** The host of a webhook address, which is all the UI and the audit trail ever show of it. */
export function urlHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function settingsDto(settings: BackupSettings): BackupSettingsDto {
  return {
    intervalMinutes: settings.intervalMinutes,
    keep: settings.keep,
    maxAgeDays: settings.maxAgeDays,
    notifyHost: urlHost(settings.notifyUrl),
    notifySuccess: settings.notifySuccess,
  };
}

/** The last failure is newer than the last success. */
export function isFailing(state: BackupState): boolean {
  const failure = state.lastFailure;
  if (!failure) return false;
  const success = Math.max(state.lastSuccess?.at ?? 0, state.lastRestore?.at ?? 0);
  return failure.at >= success;
}
