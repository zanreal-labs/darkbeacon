import type { InstanceSettingsDto, LoginMethod } from '@darkbeacon/shared';

export type InstanceSettings = InstanceSettingsDto;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  adminGuildId: null,
  adminRoleIds: [],
  webhooksToPrivateNetworks: false,
  eventRetentionDays: null,
  loginMethod: null,
  defaultMapId: null,
  mcpMode: 'off',
  apiCorsOrigins: [],
  publicMaps: true,
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
