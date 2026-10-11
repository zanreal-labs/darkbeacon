import type { DiscordLink } from '../domain/account.js';

/** Discord grants per account. The adapter encrypts the tokens at rest. */
export interface DiscordLinkRepository {
  find(accountId: string): Promise<DiscordLink | null>;
  save(link: DiscordLink): Promise<void>;
}

/**
 * Which Discord guild roles matter to the instance. Provided by access: the admin guild from
 * the instance settings plus every guild used by a map access rule.
 */
export interface DiscordGuildPolicy {
  guildIds(): Promise<string[]>;
  /** True when one of these roles makes an account an instance admin. */
  grantsAdmin(roles: ReadonlyArray<{ guildId: string; roleId: string }>): Promise<boolean>;
}
