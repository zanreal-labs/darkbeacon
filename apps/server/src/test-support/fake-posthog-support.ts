import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for PostHog's Support widget API and capture endpoint, shaped like the real ones
 * (PostHog/posthog products/conversations/backend/api/widget.py and serializers.py, as posthog-js
 * calls them): token in `X-Conversations-Token`, Origin/Referer against the allowed domains, HMAC
 * identity verification, the burst limit per `widget_session_id` (else per address), the field
 * limits, ownership by verified distinct id, and the response bodies.
 */

interface Ticket {
  id: string;
  number: number;
  distinctId: string;
  widgetSessionId: string;
  status: string;
  unreadCustomer: number;
  traits: Record<string, string>;
  sessionContext: Record<string, unknown>;
  messages: Array<{
    id: string;
    content: string;
    author: 'customer' | 'support';
    authorName: string | null;
    at: Date;
  }>;
  createdAt: Date;
}

export interface FakePostHogOptions {
  token: string;
  secret: string;
  /** `widget_domains`: empty allows every origin, as PostHog does. */
  allowedDomains?: string[];
  /** Requests a minute per widget session (PostHog: 30). */
  burst?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;

export class FakePostHogSupport {
  readonly tickets = new Map<string, Ticket>();
  /** Every widget request as received: method, path, headers and body or query. */
  readonly requests: Array<{
    method: string;
    path: string;
    headers: IncomingMessage['headers'];
    body: Record<string, unknown> | null;
    query: Record<string, string>;
  }> = [];
  /** Events sent to the capture endpoint. */
  readonly captured: Array<Record<string, unknown>> = [];
  private readonly burst = new Map<string, number[]>();
  private server: Server | null = null;
  private counter = 0;
  host = '';

  constructor(private readonly options: FakePostHogOptions) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.host = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.host;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** A staff answer from PostHog's inbox. */
  answer(ticketId: string, content: string, authorName = 'Zan'): void {
    const ticket = this.tickets.get(ticketId)!;
    ticket.messages.push({ id: randomUUID(), content, author: 'support', authorName, at: new Date() });
    ticket.unreadCustomer++;
    ticket.status = 'pending';
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const raw = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
      req.on('end', () => resolve(data));
    });
    let body: Record<string, unknown> | null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }
    const query = Object.fromEntries(url.searchParams);

    if (req.method === 'POST' && url.pathname === '/i/v0/e/') {
      this.captured.push(body ?? {});
      return send(res, 200, { status: 'Ok' });
    }

    const prefix = '/api/conversations/v1/widget';
    if (!url.pathname.startsWith(prefix)) return send(res, 404, { error: 'Not found' });
    const path = url.pathname.slice(prefix.length);
    this.requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body, query });

    if (req.headers['x-conversations-token'] !== this.options.token)
      return send(res, 401, { detail: 'Invalid token or conversations not enabled' });

    const data = req.method === 'GET' ? query : (body ?? {});
    // WidgetUserBurstThrottle: per widget_session_id when sent, else per address.
    const key =
      typeof data.widget_session_id === 'string'
        ? `s:${data.widget_session_id}`
        : `ip:${req.socket.remoteAddress}`;
    const now = Date.now();
    const recent = (this.burst.get(key) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.burst.set(key, recent);
    if (recent.length > (this.options.burst ?? 30))
      return send(res, 429, { detail: 'Request was throttled.' });

    // WidgetAuthSerializer
    if (data.widget_session_id !== undefined && !UUID.test(String(data.widget_session_id)))
      return send(res, 400, {
        error: 'Invalid request data',
        details: { widget_session_id: ['Must be a valid UUID.'] },
      });
    if (data.identity_hash !== undefined && !HEX64.test(String(data.identity_hash)))
      return send(res, 400, { error: 'Invalid request data', details: { identity_hash: ['invalid'] } });
    const hasIdentity =
      typeof data.identity_distinct_id === 'string' && typeof data.identity_hash === 'string';
    if (!hasIdentity && data.widget_session_id === undefined)
      return send(res, 400, { error: 'Invalid request data' });
    let verified: string | null = null;
    if (hasIdentity) {
      const expected = createHmac('sha256', this.options.secret)
        .update(String(data.identity_distinct_id))
        .digest('hex');
      if (expected !== data.identity_hash) return send(res, 403, { error: 'Invalid identity hash' });
      verified = String(data.identity_distinct_id);
    }

    if (req.method === 'POST' && path === '/message') return this.message(req, res, body ?? {}, verified);
    if (req.method === 'GET' && path === '/tickets') return this.list(res, verified, query);
    const thread = /^\/messages\/([^/]+)(\/read)?$/.exec(path);
    if (thread) {
      if (!UUID.test(thread[1]!)) return send(res, 400, { error: 'Invalid ticket_id format' });
      const ticket = this.tickets.get(thread[1]!);
      if (!ticket) return send(res, 404, { error: 'Ticket not found' });
      if (!verified || ticket.distinctId !== verified) return send(res, 403, { error: 'Forbidden' });
      if (req.method === 'POST' && thread[2]) {
        ticket.unreadCustomer = 0;
        return send(res, 200, { success: true, unread_count: 0 });
      }
      if (req.method === 'GET' && !thread[2]) {
        const limit = Math.min(500, Number(query.limit ?? 500));
        return send(res, 200, {
          ticket_id: ticket.id,
          ticket_status: ticket.status,
          unread_count: ticket.unreadCustomer,
          messages: ticket.messages.slice(0, limit).map((m) => ({
            id: m.id,
            content: m.content,
            rich_content: null,
            author_type: m.author,
            author_name:
              m.author === 'customer' ? (ticket.traits.name ?? 'You') : (m.authorName ?? 'Support'),
            created_at: m.at.toISOString(),
          })),
          has_more: false,
        });
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  private originAllowed(req: IncomingMessage): boolean {
    const domains = this.options.allowedDomains ?? [];
    if (domains.length === 0) return true;
    const host = (value: string | undefined) => {
      try {
        return value ? new URL(value).hostname : null;
      } catch {
        return null;
      }
    };
    const origin = host(req.headers.origin);
    const referer = host(req.headers.referer);
    return domains.some((d) => d === origin || d === referer);
  }

  private message(
    req: IncomingMessage,
    res: ServerResponse,
    body: Record<string, unknown>,
    verified: string | null,
  ): void {
    if (!this.originAllowed(req)) return send(res, 403, { error: 'Origin not allowed' });
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 10_000) return send(res, 400, { error: 'Invalid request data' });
    if (!verified) return send(res, 403, { error: 'Forbidden' });
    // _sanitize_context: traits 50 entries, 500 chars; session_context 20 entries, 2000 chars.
    const traits = bounded(body.traits, 50, 500) as Record<string, string>;
    const sessionContext = bounded(body.session_context, 20, 2000);
    let ticket: Ticket;
    if (body.ticket_id) {
      if (!UUID.test(String(body.ticket_id))) return send(res, 400, { error: 'Invalid ticket_id format' });
      const found = this.tickets.get(String(body.ticket_id));
      if (!found) return send(res, 404, { error: 'Ticket not found' });
      if (found.distinctId !== verified) return send(res, 403, { error: 'Forbidden' });
      ticket = found;
      Object.assign(ticket.traits, traits);
      Object.assign(ticket.sessionContext, sessionContext);
    } else {
      ticket = {
        id: randomUUID(),
        number: ++this.counter,
        distinctId: verified,
        // Deterministic from the HMAC, as PostHog stores it.
        widgetSessionId: String(body.identity_hash).slice(0, 32),
        status: 'new',
        unreadCustomer: 0,
        traits,
        sessionContext,
        messages: [],
        createdAt: new Date(),
      };
      this.tickets.set(ticket.id, ticket);
    }
    const comment = {
      id: randomUUID(),
      content: message,
      author: 'customer' as const,
      authorName: null,
      at: new Date(),
    };
    ticket.messages.push(comment);
    send(res, 200, {
      ticket_id: ticket.id,
      message_id: comment.id,
      ticket_status: ticket.status,
      unread_count: ticket.unreadCustomer,
      created_at: comment.at.toISOString(),
    });
  }

  private list(res: ServerResponse, verified: string | null, query: Record<string, string>): void {
    if (!verified) return send(res, 403, { error: 'Forbidden' });
    const mine = [...this.tickets.values()]
      .filter((t) => t.distinctId === verified)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const offset = Number(query.offset ?? 0);
    const limit = Number(query.limit ?? 100);
    send(res, 200, {
      count: mine.length,
      results: mine.slice(offset, offset + limit).map((t) => {
        const last = t.messages.at(-1);
        return {
          id: t.id,
          ticket_number: t.number,
          status: t.status,
          unread_count: t.unreadCustomer,
          last_message: last?.content ?? null,
          last_message_at: last?.at.toISOString() ?? null,
          message_count: t.messages.length,
          created_at: t.createdAt.toISOString(),
        };
      }),
    });
  }
}

function bounded(value: unknown, entries: number, length: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (Object.keys(out).length >= entries) break;
    if (key.length > 200) continue;
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) continue;
    out[key] = typeof v === 'string' ? v.slice(0, length) : v;
  }
  return out;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
