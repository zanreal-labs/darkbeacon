import type { DiscordBotPort, DiscordMention } from '@darkbeacon/plugin-sdk';
import type { Embed } from './describe.js';
import type { Target } from './store.js';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type SendResult =
  { ok: true } | { ok: false; error: string; retryAfterMs?: number; permanent?: boolean };

export interface Message {
  embeds: Embed[];
  mention: Pick<DiscordMention, 'kind' | 'roleId'> | null;
}

/** Discord's Create Message / Execute Webhook body: embeds, an optional mention, nothing else pings. */
export function messageBody(message: Message, username: string | null): Record<string, unknown> {
  const mention = message.mention;
  const content =
    mention?.kind === 'here'
      ? '@here'
      : mention?.kind === 'role' && mention.roleId
        ? `<@&${mention.roleId}>`
        : undefined;
  const allowed =
    mention?.kind === 'here'
      ? { parse: ['everyone'] }
      : mention?.kind === 'role' && mention.roleId
        ? { parse: [], roles: [mention.roleId] }
        : { parse: [] };
  return {
    ...(username ? { username } : {}),
    ...(content ? { content } : {}),
    embeds: message.embeds.slice(0, 10),
    allowed_mentions: allowed,
  };
}

/**
 * Posts to a channel webhook (`?wait=true`, so a refused message is an error) or as the
 * instance bot. https://docs.discord.com/developers/resources/webhook#execute-webhook
 */
export async function deliver(
  target: Target,
  message: Message,
  options: { fetch: Fetch; bot: DiscordBotPort; username: string },
): Promise<SendResult> {
  if (target.kind === 'channel') {
    try {
      await options.bot.send(target.channelId, messageBody(message, null));
      return { ok: true };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const wait = /try again in (\d+) s/.exec(text);
      return wait
        ? { ok: false, error: text, retryAfterMs: Number(wait[1]) * 1000 }
        : { ok: false, error: text };
    }
  }
  let response: Response;
  try {
    response = await options.fetch(`${target.url}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Darkbeacon' },
      body: JSON.stringify(messageBody(message, options.username)),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Discord could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true };
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string; retry_after?: number };
  if (response.status === 429) {
    return {
      ok: false,
      error: 'Discord is rate limiting this webhook',
      retryAfterMs: Math.ceil((body.retry_after ?? 5) * 1000),
    };
  }
  if (response.status === 404) {
    return { ok: false, error: 'The webhook was deleted in Discord. Paste a new one.', permanent: true };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: `Discord refused the webhook: ${body.message ?? response.status}`,
      permanent: true,
    };
  }
  return {
    ok: false,
    error: `Discord answered ${response.status}${body.message ? `: ${body.message}` : ''}`,
  };
}

/** Name and channel of a webhook, from Discord (no secret needed beyond the URL). */
export async function webhookInfo(url: string, fetchFn: Fetch): Promise<{ name: string } | null> {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { name?: string | null };
    return { name: body.name ?? 'Webhook' };
  } catch {
    return null;
  }
}
