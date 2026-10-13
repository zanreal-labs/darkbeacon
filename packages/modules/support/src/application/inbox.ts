import {
  actorRef,
  AUDIT_STREAM,
  newEvent,
  NotFoundError,
  requireInstanceRole,
  type Actor,
  type Clock,
  type EventLog,
} from '@darkbeacon/core';
import type {
  AdminSupportFeedbackDto,
  AdminSupportInboxDto,
  AdminSupportThreadDto,
  AdminSupportTicketDto,
  AdminSupportTicketsQuery,
  AdminSupportTicketUpdate,
} from '@darkbeacon/shared';
import { TICKET_ID } from '../domain/limits.js';
import type { AdminDeskTicket, SupportAdminDesk } from '../ports/index.js';
import { ticketDto, type SupportHub } from './hub.js';

/**
 * The inbox of a hub that keeps tickets itself: its instance admins read, answer and close them.
 * Answers and status changes are recorded on the audit (never the text).
 */
export class SupportInbox {
  constructor(
    private readonly deps: {
      desk: SupportAdminDesk;
      hub: SupportHub;
      events: EventLog;
      clock: Clock;
      /** The admin's name as pilots see it on answers. */
      authorName: (accountId: string) => Promise<string | null>;
    },
  ) {}

  async list(actor: Actor | null, query: AdminSupportTicketsQuery): Promise<AdminSupportInboxDto> {
    requireInstanceRole(actor, 'admin');
    const tickets = await this.deps.desk.list(query.status);
    const active = query.status === 'active' ? tickets : await this.deps.desk.list('active');
    return {
      tickets: tickets.map(adminTicketDto),
      unanswered: active.filter((t) => t.status === 'new' || t.status === 'open').length,
    };
  }

  async thread(actor: Actor | null, ticketId: string): Promise<AdminSupportThreadDto> {
    requireInstanceRole(actor, 'admin');
    if (!TICKET_ID.test(ticketId)) throw new NotFoundError('Ticket');
    const found = await this.deps.desk.get(ticketId);
    if (!found) throw new NotFoundError('Ticket');
    return {
      ticket: adminTicketDto(found.ticket),
      context: found.context,
      messages: found.messages.map((m) => ({
        id: m.id,
        body: m.body,
        author: m.author,
        authorName: m.authorName,
        createdAt: m.createdAt,
      })),
    };
  }

  async answer(actor: Actor | null, ticketId: string, message: string): Promise<AdminSupportThreadDto> {
    const admin = requireInstanceRole(actor, 'admin');
    if (!TICKET_ID.test(ticketId)) throw new NotFoundError('Ticket');
    const author = admin.kind === 'account' ? await this.deps.authorName(admin.id) : null;
    if (!(await this.deps.desk.answer(ticketId, message, author))) throw new NotFoundError('Ticket');
    await this.deps.events.append([
      newEvent({
        stream: AUDIT_STREAM,
        type: 'support.replied',
        actor: actorRef(admin),
        data: { ticketId },
        occurredAt: this.deps.clock.now(),
      }),
    ]);
    await this.refreshOwner(ticketId);
    return this.thread(admin, ticketId);
  }

  async update(
    actor: Actor | null,
    ticketId: string,
    change: AdminSupportTicketUpdate,
  ): Promise<AdminSupportThreadDto> {
    const admin = requireInstanceRole(actor, 'admin');
    if (!TICKET_ID.test(ticketId)) throw new NotFoundError('Ticket');
    const updated = await this.deps.desk.update(ticketId, change);
    if (!updated) throw new NotFoundError('Ticket');
    await this.deps.events.append([
      newEvent({
        stream: AUDIT_STREAM,
        type: 'support.ticket_updated',
        actor: actorRef(admin),
        data: { ticketId, status: updated.status, priority: updated.priority },
        occurredAt: this.deps.clock.now(),
      }),
    ]);
    await this.refreshOwner(ticketId);
    return this.thread(admin, ticketId);
  }

  async feedback(actor: Actor | null): Promise<AdminSupportFeedbackDto[]> {
    requireInstanceRole(actor, 'admin');
    return (await this.deps.desk.feedback(200)).map((f) => ({
      id: f.id,
      kind: f.kind,
      rating: f.rating,
      text: f.text,
      character:
        f.characterId !== null ? { id: f.characterId, name: f.characterName ?? 'Unknown pilot' } : null,
      createdAt: f.createdAt,
    }));
  }

  /** The pilot's cached list is stale once their ticket changed. */
  private async refreshOwner(ticketId: string): Promise<void> {
    const owner = await this.deps.desk.ownerOf(ticketId);
    if (owner) this.deps.hub.replyPosted(owner);
  }
}

function adminTicketDto(t: AdminDeskTicket): AdminSupportTicketDto {
  return {
    ...ticketDto(t),
    character: { id: t.characterId, name: t.characterName },
    priority: t.priority,
  };
}
