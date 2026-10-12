import { requireInstanceRole, ValidationError, type Actor, type UnitOfWork } from '@darkbeacon/core';
import type { LoginMethod, UpdateInstanceSettingsRequest } from '@darkbeacon/shared';
import {
  adminByDiscord,
  DEFAULT_INSTANCE_SETTINGS,
  effectiveLoginMethod,
  type InstanceSettings,
} from '../domain/instance-settings.js';
import type { AccessRuleRepository } from '../ports/access-rule-repository.js';
import type { InstanceSettingsRepository } from '../ports/instance-settings-repository.js';

export interface InstanceSettingsDeps {
  settings: InstanceSettingsRepository;
  rules: AccessRuleRepository;
  uow: UnitOfWork;
  /** Whether Discord sign-in is configured (DISCORD_CLIENT_ID/SECRET). Default true. */
  discordConfigured?: boolean;
}

/**
 * Instance settings edited in the admin tab. Also answers which Discord guild roles matter
 * (identity's `DiscordGuildPolicy`): the admin guild plus every guild used by an access rule;
 * and how people sign in (identity's `LoginPolicy`).
 */
export class InstanceSettingsService {
  constructor(private readonly deps: InstanceSettingsDeps) {}

  private get discordConfigured(): boolean {
    return this.deps.discordConfigured ?? true;
  }

  async get(actor: Actor | null): Promise<InstanceSettings> {
    requireInstanceRole(actor, 'admin');
    return this.current();
  }

  async update(actor: Actor | null, patch: UpdateInstanceSettingsRequest): Promise<InstanceSettings> {
    requireInstanceRole(actor, 'admin');
    if (patch.loginMethod === 'discord' && !this.discordConfigured) {
      throw new ValidationError(
        'Discord sign-in is not configured on this server (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET)',
      );
    }
    return this.deps.uow.transaction(async () => {
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<InstanceSettings>;
      if (changes.adminRoleIds) changes.adminRoleIds = [...new Set(changes.adminRoleIds)];
      await this.deps.settings.save(changes);
      return this.current();
    });
  }

  async current(): Promise<InstanceSettings> {
    return { ...DEFAULT_INSTANCE_SETTINGS, ...(await this.deps.settings.load()) };
  }

  /** The effective login method (identity's `LoginPolicy`). */
  async loginMethod(): Promise<LoginMethod> {
    return effectiveLoginMethod(await this.current(), this.discordConfigured);
  }

  /** Discord roles grant map access and instance admin only where people sign in with Discord. */
  async discordRoles(): Promise<boolean> {
    return (await this.loginMethod()) === 'discord';
  }

  async guildIds(): Promise<string[]> {
    const [settings, ruleGuilds] = await Promise.all([this.current(), this.deps.rules.discordGuildIds()]);
    return [...new Set([...(settings.adminGuildId ? [settings.adminGuildId] : []), ...ruleGuilds])];
  }

  async grantsAdmin(roles: ReadonlyArray<{ guildId: string; roleId: string }>): Promise<boolean> {
    if (roles.length === 0 || !(await this.discordRoles())) return false;
    return adminByDiscord(await this.current(), roles);
  }
}
