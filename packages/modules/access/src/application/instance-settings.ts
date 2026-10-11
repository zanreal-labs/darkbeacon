import { requireInstanceRole, type Actor, type UnitOfWork } from '@wormwright/core';
import type { UpdateInstanceSettingsRequest } from '@wormwright/shared';
import {
  adminByDiscord,
  DEFAULT_INSTANCE_SETTINGS,
  type InstanceSettings,
} from '../domain/instance-settings.js';
import type { AccessRuleRepository } from '../ports/access-rule-repository.js';
import type { InstanceSettingsRepository } from '../ports/instance-settings-repository.js';

export interface InstanceSettingsDeps {
  settings: InstanceSettingsRepository;
  rules: AccessRuleRepository;
  uow: UnitOfWork;
}

/**
 * Instance settings edited in the admin tab. Also answers which Discord guild roles matter
 * (identity's `DiscordGuildPolicy`): the admin guild plus every guild used by an access rule.
 */
export class InstanceSettingsService {
  constructor(private readonly deps: InstanceSettingsDeps) {}

  async get(actor: Actor | null): Promise<InstanceSettings> {
    requireInstanceRole(actor, 'admin');
    return this.current();
  }

  async update(actor: Actor | null, patch: UpdateInstanceSettingsRequest): Promise<InstanceSettings> {
    requireInstanceRole(actor, 'admin');
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

  async guildIds(): Promise<string[]> {
    const [settings, ruleGuilds] = await Promise.all([this.current(), this.deps.rules.discordGuildIds()]);
    return [...new Set([...(settings.adminGuildId ? [settings.adminGuildId] : []), ...ruleGuilds])];
  }

  async grantsAdmin(roles: ReadonlyArray<{ guildId: string; roleId: string }>): Promise<boolean> {
    return roles.length > 0 && adminByDiscord(await this.current(), roles);
  }
}
