import type { InstanceSettingsDto } from './dto/access.js';
import type { BackupSettingsDto, BackupTrigger } from './dto/backups.js';
import type { WebhookDto } from './dto/notifications.js';
import type { ApiKeyKind, ServiceKeyMapGrant } from './dto/api-keys.js';

/** An API key as the audit trail records it: everything but the secret. */
export interface ApiKeyAuditDto {
  id: string;
  kind: ApiKeyKind;
  name: string;
  scopes: string[];
  readOnly: boolean;
  expiresAt: number | null;
  allowedIps: string[];
  rateLimitPerMinute: number | null;
  ownerAccountId: string | null;
  instanceRole: 'user' | 'admin' | null;
  mapGrants: ServiceKeyMapGrant[];
  allMapsRole: ServiceKeyMapGrant['role'] | null;
}

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
  /** API keys (personal tokens and service keys); the token and its hash are never recorded. */
  'api_key.created': ApiKeyAuditDto;
  'api_key.updated': ApiKeyAuditDto;
  /** A new secret for the same key; the old one stopped working at once. */
  'api_key.rotated': { id: string; name: string; kind: ApiKeyKind; ownerAccountId: string | null };
  'api_key.revoked': { id: string; name: string; kind: ApiKeyKind; ownerAccountId: string | null };
  /** A person approved an OAuth client (an MCP client) to act for them, with these scopes. */
  'oauth.grant_created': OAuthGrantAuditDto;
  /** The approval was revoked (by the person, or because a code or refresh token was replayed). */
  'oauth.grant_revoked': OAuthGrantAuditDto;
  /** An instance admin disabled an account (it cannot sign in or use anything) or enabled it again. */
  'account.disabled_changed': { accountId: string; disabled: boolean; reason: string | null };
  /** A webhook got a new signing secret; the old one stopped working at once. */
  'webhook.secret_rotated': { id: string; mapId: string };
  /** A webhook was turned off after too many deliveries in a row failed. */
  'webhook.auto_disabled': { id: string; mapId: string; failures: number; lastError: string | null };
  /** An invite link to sign up (the token is never recorded). */
  'invite.created': { id: string; note: string | null; expiresAt: number | null; maxUses: number | null };
  'invite.revoked': { id: string };
  /** Someone signed up with an invite. */
  'invite.used': { id: string; accountId: string };
  /**
   * Support hub: a pilot opened a ticket (docs/support.md). Never the message or the context;
   * the character is there so abuse can be traced.
   */
  'support.ticket_created': {
    ticketId: string;
    category: 'bug' | 'support' | 'question';
    backend: 'posthog' | 'local';
    characterId: number;
  };
  /** Support hub with its own store: an admin answered a ticket (the text is not recorded). */
  'support.replied': { ticketId: string };
  /** Support hub with its own store: an admin changed a ticket's status or priority. */
  'support.ticket_updated': { ticketId: string; status: string; priority: string };
}

export interface OAuthGrantAuditDto {
  id: string;
  accountId: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  readOnly: boolean;
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
  'api_key.created',
  'api_key.updated',
  'api_key.rotated',
  'api_key.revoked',
  'oauth.grant_created',
  'oauth.grant_revoked',
  'account.disabled_changed',
  'webhook.secret_rotated',
  'webhook.auto_disabled',
  'invite.created',
  'invite.revoked',
  'invite.used',
  'support.ticket_created',
  'support.replied',
  'support.ticket_updated',
] as const satisfies readonly AuditEventType[];
