import {
  AUDIT_STREAM,
  actorRef,
  newEvent,
  requireInstanceRole,
  type Actor,
  type Clock,
  type EventLog,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { UpdateInstanceSettingsRequest } from '@darkbeacon/shared';
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
  /** Changes are recorded on the audit stream. */
  events: EventLog;
  clock: Clock;
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
    const admin = requireInstanceRole(actor, 'admin');
    return this.deps.uow.transaction(async () => {
      const before = await this.current();
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<InstanceSettings>;
      if (changes.adminRoleIds) changes.adminRoleIds = [...new Set(changes.adminRoleIds)];
      await this.deps.settings.save(changes);
      const after = await this.current();
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        await this.deps.events.append([
          newEvent({
            stream: AUDIT_STREAM,
            type: 'settings.changed',
            actor: actorRef(admin),
            data: after,
            occurredAt: this.deps.clock.now(),
            before,
          }),
        ]);
      }
      return after;
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
