/** The bot user behind a token. */
export interface DiscordBotUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  iconUrl: string | null;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: string | null;
  managed: boolean;
  position: number;
}

export interface DiscordChannel {
  id: string;
  name: string;
  kind: 'text' | 'announcement';
  category: string | null;
  position: number;
}

/** A message as Discord's Create Message takes it (content, embeds, allowed_mentions). */
export type DiscordMessage = Record<string, unknown>;

/**
 * Discord's REST API with a bot token (`Authorization: Bot <token>`). Adapters throw
 * `ExternalAuthError` when Discord rejects the token and wait out 429s up to a few seconds.
 */
export interface DiscordBotApi {
  me(token: string): Promise<DiscordBotUser>;
  guilds(token: string): Promise<DiscordGuild[]>;
  roles(token: string, guildId: string): Promise<DiscordRole[]>;
  channels(token: string, guildId: string): Promise<DiscordChannel[]>;
  /** POST /channels/{id}/messages; resolves with the HTTP status (errors carry Discord's message). */
  send(token: string, channelId: string, message: DiscordMessage): Promise<void>;
}

/** The instance's bot. The adapter keeps the token encrypted at rest. */
export interface DiscordBotStore {
  load(): Promise<{ token: string; user: DiscordBotUser; error: string | null } | null>;
  save(bot: { token: string; user: DiscordBotUser; error: string | null }): Promise<void>;
  clear(): Promise<void>;
}
