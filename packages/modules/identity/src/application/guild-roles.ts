import type { Clock, EventLog } from '@darkbeacon/core';
import type { DiscordLink, GuildRole } from '../domain/account.js';
import { ExternalAuthError } from '../domain/errors.js';
import { GUILD_ROLES_TTL_MS, TOKEN_REFRESH_MARGIN_MS } from '../domain/rules.js';
import type { DiscordGuildPolicy, DiscordLinkRepository } from '../ports/discord-link-repository.js';
import type { DiscordGrant, IdentityProvider } from '../ports/identity-provider.js';
import { accountChanged, IDENTITY_ACTOR, sameRoles } from './events.js';

export interface GuildRoleDeps {
  /** Null when Discord login is not configured. */
  discord: IdentityProvider | null;
  discordLinks: DiscordLinkRepository;
  guildPolicy: DiscordGuildPolicy;
  events: EventLog;
  clock: Clock;
}

/**
 * Keeps a snapshot of each account's roles on the guilds the instance cares about (admin guild,
 * guilds used by access rules). Read at login and refreshed in the background when stale.
 */
export class GuildRoleSync {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly deps: GuildRoleDeps) {}

  /** Stores a fresh grant from a login and reads the roles with it. */
  async saveGrant(accountId: string, grant: DiscordGrant): Promise<void> {
    const previous = await this.deps.discordLinks.find(accountId);
    await this.deps.discordLinks.save({
      accountId,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: grant.expiresAt,
      guildRoles: previous?.guildRoles ?? [],
      rolesCheckedAt: null,
    });
    await this.refresh(accountId);
  }

  /** Re-reads the roles unless they are fresh; concurrent calls for one account share the work. */
  refreshIfStale(accountId: string): Promise<void> {
    const running = this.inFlight.get(accountId);
    if (running) return running;
    const work = (async () => {
      const link = await this.deps.discordLinks.find(accountId);
      if (link && this.isStale(link)) await this.refresh(accountId);
    })().finally(() => this.inFlight.delete(accountId));
    this.inFlight.set(accountId, work);
    return work;
  }

  /**
   * Reads the account's roles on every relevant guild. When Discord rejects the grant the roles
   * are cleared: an account that revoked access must not keep the roles it had. A change is
   * published as `access.account_changed`, so open map streams are re-authorized.
   */
  async refresh(accountId: string): Promise<void> {
    const { discord, discordLinks, guildPolicy, clock } = this.deps;
    let link = await discordLinks.find(accountId);
    if (!link || !discord) return;
    const before = link.guildRoles;
    const save = async (current: DiscordLink, roles: GuildRole[]) => {
      await discordLinks.save({ ...current, guildRoles: roles, rolesCheckedAt: clock.now() });
      if (!sameRoles(before, roles)) {
        await this.deps.events.append([accountChanged(accountId, IDENTITY_ACTOR, clock.now())]);
      }
    };
    try {
      const guildIds = await guildPolicy.guildIds();
      if (guildIds.length > 0 && link.expiresAt - TOKEN_REFRESH_MARGIN_MS <= clock.now()) {
        const grant = await discord.refresh(link.refreshToken);
        link = { ...link, ...pickTokens(grant) };
      }
      const roles: GuildRole[] = [];
      for (const guildId of guildIds) {
        for (const roleId of (await discord.guildRoles(link.accessToken, guildId)) ?? []) {
          roles.push({ guildId, roleId });
        }
      }
      await save(link, roles);
    } catch (error) {
      if (!(error instanceof ExternalAuthError)) throw error;
      await save(link, []);
    }
  }

  private isStale(link: DiscordLink): boolean {
    return link.rolesCheckedAt === null || this.deps.clock.now() - link.rolesCheckedAt >= GUILD_ROLES_TTL_MS;
  }
}

function pickTokens(grant: DiscordGrant) {
  return { accessToken: grant.accessToken, refreshToken: grant.refreshToken, expiresAt: grant.expiresAt };
}
