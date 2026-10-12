import type { InstanceSettingsDto } from './dto/access.js';
import type { BackupSettingsDto, BackupTrigger } from './dto/backups.js';
import type { WebhookDto } from './dto/notifications.js';

/** How someone signed in. */
export type SignInProvider = 'discord' | 'eve' | 'demo' | 'dev';

/**
 * Instance audit catalogue: events on the `audit:instance` stream (see `AUDIT_STREAM` in core).
 * They record instance changes that are not map state, so they are not part of `EventPayloads`
 * (plugins and map webhooks never see them); only instance admins read them.
 */
export interface AuditEventPayloads {
  'auth.signed_in': { accountId: string; provider: SignInProvider };
  /** `accountId` is null when the sign-in failed before an account was known. */
  'auth.sign_in_failed': { provider: SignInProvider; reason: string; accountId: string | null };
  /** `device` names the browser and device of a session ended from the account page. */
  'auth.signed_out': { accountId: string; everywhere: boolean; device?: string | null };
  /** A Discord account was connected to or disconnected from a Darkbeacon account (EVE sign-in). */
  'account.discord_changed': { accountId: string; connected: boolean };
  /** The instance's Discord bot was connected or removed (the token itself is never recorded). */
  'discord_bot.changed': { configured: boolean; name: string | null };
  /** The instance settings after the change (the audit record holds the fields that changed). */
  'settings.changed': InstanceSettingsDto;
  'theme.installed': { id: string; name: string; version: string };
  'theme.removed': { id: string };
  'theme.default_changed': { themeId: string };
  /** Webhooks belong to a map, but their config is never on the map stream (secrets). */
  'webhook.created': WebhookDto;
  'webhook.updated': WebhookDto;
  'webhook.removed': { id: string; mapId: string };
  /**
   * Plugin settings (instance values, or the overrides of one map). Values of secret-looking
   * keys (tokens, webhook URLs, passwords) are replaced by a short fingerprint.
   */
  'plugin.settings_changed': { pluginId: string; mapId: string | null; values: Record<string, unknown> };
  /** An admin turned anonymous telemetry on or off (see docs/telemetry.md). */
  'telemetry.changed': { enabled: boolean };
  /** A backup of the database was written (any trigger). */
  'backup.completed': { name: string; trigger: BackupTrigger; size: number; schemaVersion: number };
  /** A backup or a restore failed; the database is unchanged. */
  'backup.failed': {
    operation: 'backup' | 'restore';
    trigger: BackupTrigger | null;
    name: string | null;
    message: string;
  };
  /**
   * The database was replaced by a backup. Recorded in the restored database, so its history
   * continues from the backup; `preRestore` holds the database as it was before.
   */
  'backup.restored': {
    name: string;
    source: 'backup' | 'upload';
    preRestore: string;
    migrationsApplied: string[];
  };
  'backup.deleted': { name: string };
  'backup.downloaded': { name: string };
  /** The alert webhook address is never recorded, only its host. */
  'backup.settings_changed': BackupSettingsDto;
}

export type AuditEventType = keyof AuditEventPayloads;

export const AUDIT_EVENT_TYPES = [
  'auth.signed_in',
  'auth.sign_in_failed',
  'auth.signed_out',
  'account.discord_changed',
  'discord_bot.changed',
  'settings.changed',
  'theme.installed',
  'theme.removed',
  'theme.default_changed',
  'webhook.created',
  'webhook.updated',
  'webhook.removed',
  'plugin.settings_changed',
  'telemetry.changed',
  'backup.completed',
  'backup.failed',
  'backup.restored',
  'backup.deleted',
  'backup.downloaded',
  'backup.settings_changed',
] as const satisfies readonly AuditEventType[];
