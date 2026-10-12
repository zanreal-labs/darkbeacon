import type { InstanceSettingsDto } from '@darkbeacon/shared';

export type InstanceSettings = InstanceSettingsDto;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  adminGuildId: null,
  adminRoleIds: [],
  webhooksToPrivateNetworks: false,
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
