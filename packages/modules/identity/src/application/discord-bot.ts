import { requireInstanceRole, ValidationError, type Actor, type Clock } from '@darkbeacon/core';
import type { DiscordBotDto, DiscordChannelDto, DiscordGuildDto, DiscordRoleDto } from '@darkbeacon/shared';
import { ExternalAuthError } from '../domain/errors.js';
import type { DiscordBotApi, DiscordBotStore, DiscordBotUser, DiscordMessage } from '../ports/discord-bot.js';

export interface DiscordBotDeps {
  api: DiscordBotApi;
  store: DiscordBotStore;
  clock: Clock;
}

/**
 * What the bot needs on a server: View Channel (1 << 10), Send Messages (1 << 11), Embed Links
 * (1 << 14) and Mention Everyone (1 << 17, for @here and roles that are not mentionable).
 * https://docs.discord.com/developers/topics/permissions
 */
export const DISCORD_BOT_PERMISSIONS = (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 17n);

/** Lists change rarely and Discord rate-limits them; a minute is fresh enough for pickers. */
const LIST_TTL_MS = 60_000;

/**
 * The instance's optional Discord bot: with it, admins pick Discord servers, roles and channels
 * from lists instead of pasting ids, and notifications can post to a channel without a webhook.
 */
export class DiscordBotService {
  private readonly lists = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly deps: DiscordBotDeps) {}

  /** Forgets the cached Discord lists (the stored bot may have changed under it, e.g. a restore). */
  forgetCachedLists(): void {
    this.lists.clear();
  }

  async status(actor: Actor | null): Promise<DiscordBotDto> {
    requireInstanceRole(actor, 'admin');
    return toDto(await this.deps.store.load());
  }

  /** Checks the token with Discord, then keeps it (encrypted) and forgets cached lists. */
  async connect(actor: Actor | null, token: string): Promise<DiscordBotDto> {
    requireInstanceRole(actor, 'admin');
    let user: DiscordBotUser;
    try {
      user = await this.deps.api.me(token.trim());
    } catch (error) {
      if (error instanceof ExternalAuthError) {
        throw new ValidationError('Discord did not accept this token. Copy it again from the Bot page.');
      }
      throw error;
    }
    const bot = { token: token.trim(), user, error: null };
    await this.deps.store.save(bot);
    this.lists.clear();
    return toDto(bot);
  }

  async disconnect(actor: Actor | null): Promise<void> {
    requireInstanceRole(actor, 'admin');
    await this.deps.store.clear();
    this.lists.clear();
  }

  async configured(): Promise<boolean> {
    return (await this.deps.store.load()) !== null;
  }

  guilds(): Promise<DiscordGuildDto[]> {
    return this.cached('guilds', (token) => this.deps.api.guilds(token));
  }

  async roles(guildId: string): Promise<DiscordRoleDto[]> {
    const roles = await this.cached(`roles:${guildId}`, (token) => this.deps.api.roles(token, guildId));
    return [...roles]
      .filter((r) => r.id !== guildId) // @everyone shares the guild's id
      .sort((a, b) => b.position - a.position)
      .map(({ id, name, color, managed }) => ({ id, name, color, managed }));
  }

  async channels(guildId: string): Promise<DiscordChannelDto[]> {
    const channels = await this.cached(`channels:${guildId}`, (token) =>
      this.deps.api.channels(token, guildId),
    );
    return [...channels]
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.position - b.position)
      .map(({ id, name, kind, category }) => ({ id, name, kind, category }));
  }

  /** Posts a message as the bot; throws with Discord's reason when it cannot. */
  async send(channelId: string, message: DiscordMessage): Promise<void> {
    const token = await this.token();
    await this.deps.api.send(token, channelId, message);
  }

  private async token(): Promise<string> {
    const bot = await this.deps.store.load();
    if (!bot) throw new ValidationError('No Discord bot is connected on this instance');
    return bot.token;
  }

  private async cached<T>(key: string, load: (token: string) => Promise<T>): Promise<T> {
    const hit = this.lists.get(key);
    if (hit && this.deps.clock.now() - hit.at < LIST_TTL_MS) return hit.value as T;
    const bot = await this.deps.store.load();
    if (!bot) return [] as T;
    try {
      const value = await load(bot.token);
      this.lists.set(key, { value, at: this.deps.clock.now() });
      if (bot.error) await this.deps.store.save({ ...bot, error: null });
      return value;
    } catch (error) {
      if (error instanceof ExternalAuthError) {
        await this.deps.store.save({ ...bot, error: error.message });
        throw new ValidationError(`Discord refused the bot: ${error.message}`);
      }
      throw error;
    }
  }
}

function toDto(bot: { user: DiscordBotUser; error: string | null } | null): DiscordBotDto {
  if (!bot) return { configured: false, name: null, avatarUrl: null, inviteUrl: null, error: null };
  const invite = new URLSearchParams({
    client_id: bot.user.id,
    scope: 'bot',
    permissions: DISCORD_BOT_PERMISSIONS.toString(),
  });
  return {
    configured: true,
    name: bot.user.name,
    avatarUrl: bot.user.avatarUrl,
    inviteUrl: `https://discord.com/oauth2/authorize?${invite}`,
    error: bot.error,
  };
}
