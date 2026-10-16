import type { InstanceSettingsDto, LoginMethod } from '@darkbeacon/shared';

export type InstanceSettings = InstanceSettingsDto;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  adminGuildId: null,
  adminRoleIds: [],
  webhooksToPrivateNetworks: false,
  eventRetentionDays: null,
  loginMethod: null,
  defaultMapId: null,
  // The sweeper: delete holes an hour after they cannot exist any more (estimates can be off, and
  // a hole taken away under a pilot costs more than one left a little long), mark them EOL when
  // their last 4 hours begin, hide systems left alone for 15 minutes.
  expiredConnectionMinutes: 60,
  autoEol: true,
  staleSystemMinutes: 15,
  mcpMode: 'off',
  apiCorsOrigins: [],
  publicMaps: true,
  mapCreation: 'everyone',
  apiAccess: true,
  webhooksEnabled: true,
  signIn: { mode: 'open', corporationIds: [], allianceIds: [], guildIds: [] },
};

/** True when one of the account's guild roles is an admin role on the configured admin guild. */
export function adminByDiscord(
  settings: InstanceSettings,
  roles: ReadonlyArray<{ guildId: string; roleId: string }>,
): boolean {
  const { adminGuildId, adminRoleIds } = settings;
  if (!adminGuildId || adminRoleIds.length === 0) return false;
  return roles.some((r) => r.guildId === adminGuildId && adminRoleIds.includes(r.roleId));
}

/**
 * How people sign in: EVE whenever Discord is not configured (there is no other way in), else
 * what the admin chose, Discord by default.
 */
export function effectiveLoginMethod(settings: InstanceSettings, discordConfigured: boolean): LoginMethod {
  if (!discordConfigured) return 'eve';
  return settings.loginMethod ?? 'discord';
}
