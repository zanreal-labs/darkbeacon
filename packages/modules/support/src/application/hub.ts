import {
  AUDIT_STREAM,
  ForbiddenError,
  newEvent,
  NotFoundError,
  RateLimitedError,
  type Clock,
  type EventLog,
} from '@darkbeacon/core';
import {
  isSupportOrigin,
  sanitizeSupportContext,
  SUPPORT_HANDLE,
  type CreateSupportTicketRequest,
  type SupportBackend,
  type SupportFeedbackRequest,
  type SupportHandleDto,
  type SupportMessageDto,
  type SupportThreadDto,
  type SupportTicketDto,
} from '@darkbeacon/shared';
import { identityOf, resolveIdentity, type EveSignIn, type SupportIdentity } from '../domain/identity.js';
import {
  SUPPORT_CACHE_MS,
  SUPPORT_HANDLES_MAX,
  SUPPORT_LIMITS,
  TICKET_ID,
  type SupportLimitName,
} from '../domain/limits.js';
import type {
  DeskMessage,
  DeskThread,
  DeskTicket,
  FeedbackSink,
  SupportCrypto,
  SupportDesk,
  SupportHandleStore,
  SupportIdentityStore,
  SupportLimiter,
  TicketNotes,
} from '../ports/index.js';
import { TtlCache } from './cache.js';

export interface SupportHubDeps {
  desk: SupportDesk;
  /** Null when feedback has nowhere to go (PostHog desk without a surveys project). */
  feedback: FeedbackSink | null;
  identities: SupportIdentityStore;
  handles: SupportHandleStore;
  notes: TicketNotes;
  crypto: SupportCrypto;
  limiter: SupportLimiter;
  events: EventLog;
  clock: Clock;
}

const PREVIEW = 160;

/**
 * The support hub's use cases: signing a pilot in as a support identity, their tickets and
 * threads (through the desk, cached briefly), feedback, and unread handles for other instances.
 * The HTTP edge has already checked the hub session and its CSRF token; this checks ownership,
 * limits and input once more.
 */
export class SupportHub {
  private readonly lists: TtlCache<DeskTicket[]>;
  private readonly threads: TtlCache<DeskThread | null>;

  constructor(private readonly deps: SupportHubDeps) {
    this.lists = new TtlCache(SUPPORT_CACHE_MS, () => deps.clock.now());
    this.threads = new TtlCache(SUPPORT_CACHE_MS, () => deps.clock.now());
  }

  get backend(): SupportBackend {
    return this.deps.desk.backend;
  }

  get feedbackEnabled(): boolean {
    return this.deps.feedback !== null;
  }

  /** The identity of a verified EVE sign-in: the owner's own, or a new one for a new owner. */
  async signIn(eve: EveSignIn): Promise<SupportIdentity> {
    const known = await this.deps.identities.ofCharacter(eve.characterId);
    const { record } = resolveIdentity(known, eve);
    await this.deps.identities.save(record, this.deps.clock.now());
    return identityOf(record);
  }

  async tickets(identity: SupportIdentity): Promise<SupportTicketDto[]> {
    const tickets = await this.list(identity);
    const missing = tickets.filter((t) => t.category === null).map((t) => t.id);
    const categories = missing.length > 0 ? await this.deps.notes.categories(missing) : new Map();
    return tickets.map((t) => ticketDto({ ...t, category: t.category ?? categories.get(t.id) ?? null }));
  }

  async unread(identity: SupportIdentity): Promise<number> {
    return (await this.list(identity)).reduce((sum, t) => sum + Math.max(0, t.unread), 0);
  }

  async create(identity: SupportIdentity, request: CreateSupportTicketRequest): Promise<{ id: string }> {
    this.limit('tickets', identity.distinctId);
    // The edge parsed it; the error lines are scrubbed again whatever the page did.
    const context = sanitizeSupportContext(request.context);
    const { id } = await this.deps.desk.createTicket(identity, {
      category: request.category,
      message: request.message,
      context,
    });
    const now = this.deps.clock.now();
    await this.deps.notes.save(id, {
      distinctId: identity.distinctId,
      category: request.category,
      createdAt: now,
    });
    this.forget(identity.distinctId);
    await this.deps.events.append([
      newEvent({
        stream: AUDIT_STREAM,
        type: 'support.ticket_created',
        actor: { kind: 'system', id: 'support-hub' },
        data: {
          ticketId: id,
          category: request.category,
          backend: this.deps.desk.backend,
          characterId: identity.characterId,
        },
        occurredAt: now,
      }),
    ]);
    return { id };
  }

  async thread(identity: SupportIdentity, ticketId: string): Promise<SupportThreadDto> {
    const thread = await this.loadThread(identity, ticketId);
    const categories =
      thread.ticket.category === null ? await this.deps.notes.categories([thread.ticket.id]) : null;
    return {
      ticket: ticketDto({
        ...thread.ticket,
        category: thread.ticket.category ?? categories?.get(thread.ticket.id) ?? null,
      }),
      messages: thread.messages.map(messageDto),
    };
  }

  async reply(identity: SupportIdentity, ticketId: string, message: string): Promise<SupportThreadDto> {
    checkTicketId(ticketId);
    this.limit('replies', identity.distinctId);
    if (!(await this.deps.desk.reply(identity, ticketId, message))) throw new NotFoundError('Ticket');
    this.forget(identity.distinctId);
    return this.thread(identity, ticketId);
  }

  async markRead(identity: SupportIdentity, ticketId: string): Promise<void> {
    checkTicketId(ticketId);
    if (!(await this.deps.desk.markRead(identity, ticketId))) throw new NotFoundError('Ticket');
    this.forget(identity.distinctId);
  }

  /** A survey answer; `identity` null keeps it anonymous, `address` limits anonymous senders. */
  async feedback(
    identity: SupportIdentity | null,
    request: SupportFeedbackRequest,
    address: string | null,
  ): Promise<void> {
    if (!this.deps.feedback) throw new NotFoundError('Feedback');
    this.limit('feedback', identity?.distinctId ?? `address:${address ?? 'unknown'}`);
    await this.deps.feedback.send({
      id: this.deps.crypto.uuid(),
      kind: request.kind,
      rating: request.rating ?? null,
      text: request.text,
      identity,
      context: request.context,
      at: this.deps.clock.now(),
    });
  }

  /**
   * An opaque handle another instance can poll for this identity's unread count (and nothing
   * else). Returned once; the hub keeps its hash.
   */
  async createHandle(identity: SupportIdentity, origin: string): Promise<string> {
    if (!isSupportOrigin(origin))
      throw new ForbiddenError('Unread replies can only be shown on an https address');
    this.limit('handles', identity.distinctId);
    const existing = await this.deps.handles.ofIdentity(identity.distinctId);
    // One per instance: a new one replaces the old.
    for (const old of existing.filter((h) => h.origin === origin))
      await this.deps.handles.revoke(identity.distinctId, old.id);
    const others = existing.filter((h) => h.origin !== origin).sort((a, b) => a.createdAt - b.createdAt);
    for (const old of others.slice(0, Math.max(0, others.length - (SUPPORT_HANDLES_MAX - 1))))
      await this.deps.handles.revoke(identity.distinctId, old.id);
    const token = `dbsh_${this.deps.crypto.randomToken(32)}`;
    await this.deps.handles.create({
      id: this.deps.crypto.uuid(),
      tokenHash: this.deps.crypto.sha256Hex(token),
      distinctId: identity.distinctId,
      origin,
      createdAt: this.deps.clock.now(),
      lastUsedAt: null,
    });
    return token;
  }

  async handles(identity: SupportIdentity): Promise<SupportHandleDto[]> {
    const handles = await this.deps.handles.ofIdentity(identity.distinctId);
    return handles
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, origin, createdAt, lastUsedAt }) => ({ id, origin, createdAt, lastUsedAt }));
  }

  async revokeHandle(identity: SupportIdentity, id: string): Promise<void> {
    if (!(await this.deps.handles.revoke(identity.distinctId, id))) throw new NotFoundError('Handle');
  }

  /**
   * The unread count behind a handle. `requestOrigin` is the browser's `Origin`: a handle only
   * answers the instance it was made for.
   */
  async unreadForHandle(token: string, requestOrigin: string | null): Promise<number> {
    if (!SUPPORT_HANDLE.test(token)) throw new NotFoundError('Handle');
    if (
      !this.deps.limiter.take(
        `support:unread:${token.slice(5, 21)}`,
        SUPPORT_LIMITS.unread.limit,
        SUPPORT_LIMITS.unread.perMinutes,
      )
    )
      throw new RateLimitedError('Too many unread checks; try again in a minute');
    const handle = await this.deps.handles.byTokenHash(this.deps.crypto.sha256Hex(token));
    if (!handle) throw new NotFoundError('Handle');
    if (requestOrigin !== null && requestOrigin !== handle.origin)
      throw new ForbiddenError('This handle belongs to another instance');
    const now = this.deps.clock.now();
    // Recording every poll would be a write each two minutes per pilot; once an hour says enough.
    if (handle.lastUsedAt === null || now - handle.lastUsedAt > 60 * 60 * 1000)
      await this.deps.handles.touch(handle.id, now);
    const identity = identityFromDistinctId(handle.distinctId);
    return this.unread(identity);
  }

  /** A reply was posted somewhere this hub does not see (PostHog): read the list again next time. */
  replyPosted(distinctId: string): void {
    this.forget(distinctId);
  }

  private async list(identity: SupportIdentity): Promise<DeskTicket[]> {
    const cached = this.lists.get(identity.distinctId);
    if (cached) return cached;
    const fresh = (await this.deps.desk.listTickets(identity)).sort((a, b) => b.createdAt - a.createdAt);
    this.lists.set(identity.distinctId, fresh);
    return fresh;
  }

  private async loadThread(identity: SupportIdentity, ticketId: string): Promise<DeskThread> {
    checkTicketId(ticketId);
    const key = `${identity.distinctId}|${ticketId}`;
    let thread = this.threads.get(key);
    if (thread === undefined) {
      thread = await this.deps.desk.thread(identity, ticketId);
      this.threads.set(key, thread);
    }
    if (!thread) throw new NotFoundError('Ticket');
    return thread;
  }

  private forget(distinctId: string): void {
    this.lists.delete(distinctId);
    this.threads.deleteWhere((key) => key.startsWith(`${distinctId}|`));
  }

  private limit(name: SupportLimitName, who: string): void {
    const { limit, perMinutes } = SUPPORT_LIMITS[name];
    if (!this.deps.limiter.take(`support:${name}:${who}`, limit, perMinutes)) {
      throw new RateLimitedError(
        name === 'tickets'
          ? `You can open ${limit} tickets an hour; add to an open ticket instead`
          : 'Too many in a short while; try again later',
        Math.ceil((perMinutes * 60) / limit),
      );
    }
  }
}

/** A handle only knows the distinct id; the name is not needed to read a count. */
function identityFromDistinctId(distinctId: string): SupportIdentity {
  const match = /^eve:(\d+)/.exec(distinctId);
  return { distinctId, characterId: match ? Number(match[1]) : 0, characterName: '' };
}

function checkTicketId(ticketId: string): void {
  if (!TICKET_ID.test(ticketId)) throw new NotFoundError('Ticket');
}

export function ticketDto(t: DeskTicket): SupportTicketDto {
  return {
    id: t.id,
    number: t.number,
    category: t.category,
    status: t.status,
    unread: Math.max(0, t.unread),
    preview: t.preview === null ? null : t.preview.slice(0, PREVIEW),
    lastMessageAt: t.lastMessageAt,
    createdAt: t.createdAt,
    messageCount: t.messageCount,
  };
}

function messageDto(m: DeskMessage): SupportMessageDto {
  return {
    id: m.id,
    body: m.body,
    author: m.author === 'customer' ? 'you' : 'support',
    authorName: m.author === 'customer' ? null : m.authorName,
    createdAt: m.createdAt,
  };
}
