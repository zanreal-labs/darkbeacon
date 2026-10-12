import {
  ExternalAuthError,
  type DiscordBotApi,
  type DiscordBotUser,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordMessage,
  type DiscordRole,
} from '@darkbeacon/identity';
import type { FetchLike } from './oauth-http.js';

const API = 'https://discord.com/api/v10';
/** Waits out a 429 this long at most; longer waits fail the call (the caller retries later). */
const MAX_WAIT_MS = 5_000;

/** Channel types Darkbeacon posts to: GUILD_TEXT (0) and GUILD_ANNOUNCEMENT (5). */
const POSTABLE: Record<number, DiscordChannel['kind']> = { 0: 'text', 5: 'announcement' };
const CATEGORY = 4;

/**
 * Discord's REST API with a bot token. 401/403 on the bot itself mean the token is bad; a 429 is
 * waited out once (`retry_after`, seconds) when it is short.
 * https://docs.discord.com/developers/topics/rate-limits
 */
export class DiscordBotHttp implements DiscordBotApi {
  constructor(
    private readonly fetchFn: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async me(token: string): Promise<DiscordBotUser> {
    const user = (await this.json(token, '/users/@me')) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    };
    return {
      id: user.id,
      name: user.global_name ?? user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
    };
  }

  async guilds(token: string): Promise<DiscordGuild[]> {
    const guilds = (await this.json(token, '/users/@me/guilds?limit=200')) as Array<{
      id: string;
      name: string;
      icon: string | null;
    }>;
    return guilds.map((g) => ({
      id: g.id,
      name: g.name,
      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    }));
  }

  async roles(token: string, guildId: string): Promise<DiscordRole[]> {
    const roles = (await this.json(token, `/guilds/${encodeURIComponent(guildId)}/roles`)) as Array<{
      id: string;
      name: string;
      color: number;
      managed: boolean;
      position: number;
    }>;
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
      managed: r.managed,
      position: r.position,
    }));
  }

  async channels(token: string, guildId: string): Promise<DiscordChannel[]> {
    const channels = (await this.json(token, `/guilds/${encodeURIComponent(guildId)}/channels`)) as Array<{
      id: string;
      name: string;
      type: number;
      position: number;
      parent_id?: string | null;
    }>;
    const categories = new Map(channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, c.name]));
    return channels.flatMap((c) => {
      const kind = POSTABLE[c.type];
      if (!kind) return [];
      return [
        {
          id: c.id,
          name: c.name,
          kind,
          category: c.parent_id ? (categories.get(c.parent_id) ?? null) : null,
          position: c.position,
        },
      ];
    });
  }

  async send(token: string, channelId: string, message: DiscordMessage): Promise<void> {
    await this.request(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }

  private async json(token: string, path: string): Promise<unknown> {
    return (await this.request(token, path)).json();
  }

  private async request(
    token: string,
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<Response> {
    const response = await this.fetchFn(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bot ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'DiscordBot (https://github.com/darkbeacon, 1.0)',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) {
      const body = (await response.json().catch(() => ({}))) as { retry_after?: number };
      const seconds = body.retry_after ?? (Number(response.headers.get('retry-after')) || 1);
      const waitMs = Math.ceil(seconds * 1000);
      if (!retried && waitMs <= MAX_WAIT_MS) {
        await this.sleep(waitMs);
        return this.request(token, path, init, true);
      }
      throw new Error(`Discord is rate limiting; try again in ${Math.ceil(waitMs / 1000)} s`);
    }
    if (response.status === 401) throw new ExternalAuthError('discord', 'Discord rejected the bot token');
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(discordReason(response.status, body.message));
    }
    return response;
  }
}

/** A sentence for the delivery status, from Discord's status and message. */
export function discordReason(status: number, message: string | undefined): string {
  if (status === 403)
    return `Discord refused: ${message ?? 'Missing access'} (check the bot's channel permissions)`;
  if (status === 404) return `Discord could not find it: ${message ?? 'Unknown channel'}`;
  return `Discord answered ${status}${message ? `: ${message}` : ''}`;
}
