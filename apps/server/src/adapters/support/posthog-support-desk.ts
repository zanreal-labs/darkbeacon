import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { RateLimitedError } from '@darkbeacon/core';
import {
  flattenSupportContext,
  SupportTicketStatus,
  type SupportCategory,
  type SupportContext,
} from '@darkbeacon/shared';
import type { DeskMessage, DeskThread, DeskTicket, SupportDesk, SupportIdentity } from '@darkbeacon/support';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** PostHog's identity verification: HMAC-SHA256 of the distinct id with the Support secret, hex. */
export function identityHash(distinctId: string, secret: string): string {
  return createHmac('sha256', secret).update(distinctId, 'utf8').digest('hex');
}

/**
 * A stable UUID per identity for `widget_session_id`. With a verified identity PostHog does not
 * need it (it derives its own from the hash), but it keys its per-user burst limit on it: without
 * one, every pilot's requests from this server would share one bucket (30 a minute per address).
 */
export function widgetSessionId(distinctId: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(`widget-session:${distinctId}`, 'utf8').digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** PostHog Support could not be reached or refused the hub itself (not the pilot). */
export class SupportUnavailable extends HttpException {
  constructor(message = 'Support is not reachable right now; try again in a few minutes') {
    super(message, 503);
  }
}

interface WidgetTicket {
  id: string;
  ticket_number?: number | null;
  status: string;
  unread_count?: number | null;
  last_message?: string | null;
  last_message_at?: string | null;
  message_count?: number | null;
  created_at: string;
}

interface WidgetMessage {
  id: string;
  content: string;
  author_type: string;
  author_name?: string | null;
  created_at: string;
}

export interface PostHogSupportOptions {
  /** e.g. `https://eu.i.posthog.com` (the widget API is served under /api on it). */
  host: string;
  /** The Support widget's public token (`X-Conversations-Token`). */
  publicToken: string;
  /** The Support "Secret API key" that signs identities. Never leaves the server. */
  secretKey: string;
  /** The hub's own origin: sent as Origin and Referer, which PostHog checks against Allowed domains. */
  origin: string;
  fetch: Fetch;
  userAgent: string;
  timeoutMs?: number;
}

/**
 * PostHog Support through the widget's HTTP API, called by the hub's server with a verified
 * identity, exactly as posthog-js does from a browser
 * (packages/browser/src/extensions/conversations/external/index.tsx):
 *
 *   POST {host}/api/conversations/v1/widget/message            new ticket (ticket_id null) or reply
 *   GET  {host}/api/conversations/v1/widget/tickets             the identity's tickets
 *   GET  {host}/api/conversations/v1/widget/messages/:ticket    a thread
 *   POST {host}/api/conversations/v1/widget/messages/:ticket/read
 *
 * with `X-Conversations-Token: <public token>` and `identity_distinct_id` + `identity_hash` (HMAC of
 * the distinct id with the secret key) in the body or the query. This API is undocumented and
 * may change; the staff API cannot create tickets, which is why the widget API is used.
 */
export class PostHogSupportDesk implements SupportDesk {
  readonly backend = 'posthog' as const;
  private readonly base: string;

  constructor(private readonly options: PostHogSupportOptions) {
    this.base = `${options.host.replace(/\/+$/, '')}/api/conversations/v1/widget`;
  }

  async createTicket(
    identity: SupportIdentity,
    input: { category: SupportCategory; message: string; context: SupportContext },
  ): Promise<{ id: string }> {
    const answer = await this.send<{ ticket_id: string }>('POST', '/message', {
      body: {
        ...this.message(identity, input.message, null),
        session_context: { category: input.category, ...flattenSupportContext(input.context) },
      },
    });
    if (!answer.ok || typeof answer.body?.ticket_id !== 'string') throw this.failure(answer.status);
    return { id: answer.body.ticket_id };
  }

  async listTickets(identity: SupportIdentity): Promise<DeskTicket[]> {
    const answer = await this.send<{ results?: WidgetTicket[] }>('GET', '/tickets', {
      query: { limit: '100', offset: '0', ...this.auth(identity) },
    });
    if (!answer.ok) throw this.failure(answer.status);
    return (answer.body?.results ?? []).map(toTicket);
  }

  async thread(identity: SupportIdentity, ticketId: string): Promise<DeskThread | null> {
    const tickets = await this.listTickets(identity);
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return null;
    const answer = await this.send<{
      ticket_status?: string;
      unread_count?: number;
      messages?: WidgetMessage[];
    }>('GET', `/messages/${encodeURIComponent(ticketId)}`, {
      query: { limit: '500', ...this.auth(identity) },
    });
    if (answer.status === 403 || answer.status === 404) return null;
    if (!answer.ok) throw this.failure(answer.status);
    const status = SupportTicketStatus.safeParse(answer.body?.ticket_status);
    return {
      ticket: {
        ...ticket,
        ...(status.success ? { status: status.data } : {}),
        ...(typeof answer.body?.unread_count === 'number' ? { unread: answer.body.unread_count } : {}),
      },
      messages: (answer.body?.messages ?? []).map(toMessage),
    };
  }

  async reply(identity: SupportIdentity, ticketId: string, message: string): Promise<boolean> {
    const answer = await this.send('POST', '/message', { body: this.message(identity, message, ticketId) });
    if (answer.status === 403 || answer.status === 404) return false;
    if (!answer.ok) throw this.failure(answer.status);
    return true;
  }

  async markRead(identity: SupportIdentity, ticketId: string): Promise<boolean> {
    const answer = await this.send('POST', `/messages/${encodeURIComponent(ticketId)}/read`, {
      body: this.auth(identity),
    });
    if (answer.status === 403 || answer.status === 404) return false;
    if (!answer.ok) throw this.failure(answer.status);
    return true;
  }

  /** The verified identity, as posthog-js sends it, plus a stable session for the burst limit. */
  private auth(identity: SupportIdentity): Record<string, string> {
    return {
      identity_distinct_id: identity.distinctId,
      identity_hash: identityHash(identity.distinctId, this.options.secretKey),
      widget_session_id: widgetSessionId(identity.distinctId, this.options.secretKey),
    };
  }

  private message(identity: SupportIdentity, message: string, ticketId: string | null) {
    return {
      message,
      ticket_id: ticketId,
      ...this.auth(identity),
      distinct_id: identity.distinctId,
      // The name staff see on the ticket; no email is ever sent.
      traits: { name: identity.characterName },
    };
  }

  private failure(status: number): Error {
    if (status === 429) return new RateLimitedError('Support is busy; try again in a minute');
    return new SupportUnavailable();
  }

  private async send<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    request: { query?: Record<string, string>; body?: unknown },
  ): Promise<{ ok: boolean; status: number; body: T | null }> {
    const url = `${this.base}${path}${request.query ? `?${new URLSearchParams(request.query)}` : ''}`;
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          'x-conversations-token': this.options.publicToken,
          origin: this.options.origin,
          referer: `${this.options.origin}/support`,
          'user-agent': this.options.userAgent,
          ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new SupportUnavailable();
    }
    const body = (await response.json().catch(() => null)) as T | null;
    return { ok: response.ok, status: response.status, body };
  }
}

const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

function toTicket(t: WidgetTicket): DeskTicket {
  const status = SupportTicketStatus.safeParse(t.status);
  return {
    id: String(t.id),
    number: typeof t.ticket_number === 'number' ? t.ticket_number : null,
    category: null,
    status: status.success ? status.data : 'open',
    unread: typeof t.unread_count === 'number' ? t.unread_count : 0,
    preview: typeof t.last_message === 'string' ? t.last_message : null,
    lastMessageAt: time(t.last_message_at),
    createdAt: time(t.created_at) ?? 0,
    messageCount: typeof t.message_count === 'number' ? t.message_count : 0,
  };
}

function toMessage(m: WidgetMessage): DeskMessage {
  const customer = m.author_type === 'customer';
  return {
    id: String(m.id),
    body: typeof m.content === 'string' ? m.content : '',
    author: customer ? 'customer' : 'support',
    authorName: customer ? null : (m.author_name ?? null),
    createdAt: time(m.created_at) ?? 0,
  };
}
