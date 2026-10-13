import { newId, type Clock } from '@darkbeacon/core';
import { isUniqueViolation, json, type Database } from '@darkbeacon/db';
import {
  sanitizeSupportContext,
  SupportCategory,
  SupportPriority,
  SupportTicketStatus,
  type SupportContext,
} from '@darkbeacon/shared';
import type {
  AdminDeskTicket,
  DeskMessage,
  DeskThread,
  DeskTicket,
  FeedbackRecord,
  FeedbackSink,
  FeedbackSubmission,
  SupportAdminDesk,
  SupportDesk,
  SupportIdentity,
} from '@darkbeacon/support';

interface LocalTables {
  support_tickets: {
    id: string;
    number: number;
    distinct_id: string;
    character_id: number;
    character_name: string;
    category: string;
    status: string;
    priority: string;
    context: string;
    preview: string | null;
    message_count: number;
    unread_customer: number;
    unread_team: number;
    created_at: number;
    updated_at: number;
    last_message_at: number | null;
  };
  support_messages: {
    id: string;
    ticket_id: string;
    author: string;
    author_name: string | null;
    body: string;
    created_at: number;
  };
  support_feedback: {
    id: string;
    kind: string;
    rating: number | null;
    text: string;
    distinct_id: string | null;
    character_id: number | null;
    character_name: string | null;
    context: string;
    created_at: number;
  };
}

type TicketRow = LocalTables['support_tickets'];

const PREVIEW = 200;
/** A pilot's list shows their most recent tickets. */
const LIST_LIMIT = 100;

/**
 * The hub's own ticket store (`SUPPORT_BACKEND=local`): the same desk as PostHog for pilots, and
 * an inbox for the hub's instance admins. Feedback is kept here too.
 */
export class LocalSupportDesk implements SupportDesk, SupportAdminDesk, FeedbackSink {
  readonly backend = 'local' as const;

  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db<LocalTables>();
  }

  async createTicket(
    identity: SupportIdentity,
    input: { category: SupportCategory; message: string; context: SupportContext },
  ): Promise<{ id: string }> {
    const id = newId();
    // The running number is the highest plus one; two tickets at once retry on the unique index.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.database.transaction(async () => {
          const now = this.clock.now();
          const top = await this.db
            .selectFrom('support_tickets')
            .select((eb) => eb.fn.max('number').as('top'))
            .executeTakeFirst();
          await this.db
            .insertInto('support_tickets')
            .values({
              id,
              number: Number(top?.top ?? 0) + 1,
              distinct_id: identity.distinctId,
              character_id: identity.characterId,
              character_name: identity.characterName,
              category: input.category,
              status: 'new',
              priority: 'medium',
              context: json.encode(input.context),
              preview: input.message.slice(0, PREVIEW),
              message_count: 1,
              unread_customer: 0,
              unread_team: 1,
              created_at: now,
              updated_at: now,
              last_message_at: now,
            })
            .execute();
          await this.insertMessage(id, 'customer', null, input.message, now);
        });
        return { id };
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 9) throw error;
      }
    }
  }

  async listTickets(identity: SupportIdentity): Promise<DeskTicket[]> {
    const rows = await this.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('distinct_id', '=', identity.distinctId)
      .orderBy('created_at', 'desc')
      .limit(LIST_LIMIT)
      .execute();
    return rows.map(toTicket);
  }

  async thread(identity: SupportIdentity, ticketId: string): Promise<DeskThread | null> {
    const row = await this.owned(identity, ticketId);
    return row ? { ticket: toTicket(row), messages: await this.messagesOf(ticketId) } : null;
  }

  async reply(identity: SupportIdentity, ticketId: string, message: string): Promise<boolean> {
    return this.database.transaction(async () => {
      const row = await this.owned(identity, ticketId);
      if (!row) return false;
      const now = this.clock.now();
      await this.insertMessage(ticketId, 'customer', null, message, now);
      // A pilot writing again reopens what was waiting on them or closed.
      const status = row.status === 'new' ? 'new' : 'open';
      await this.db
        .updateTable('support_tickets')
        .set((eb) => ({
          status,
          preview: message.slice(0, PREVIEW),
          message_count: eb('message_count', '+', 1),
          unread_team: eb('unread_team', '+', 1),
          updated_at: now,
          last_message_at: now,
        }))
        .where('id', '=', ticketId)
        .execute();
      return true;
    });
  }

  async markRead(identity: SupportIdentity, ticketId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('support_tickets')
      .set({ unread_customer: 0 })
      .where('id', '=', ticketId)
      .where('distinct_id', '=', identity.distinctId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  // ---- Admin inbox ----

  async list(filter: SupportTicketStatus | 'all' | 'active'): Promise<AdminDeskTicket[]> {
    let query = this.db.selectFrom('support_tickets').selectAll();
    if (filter === 'active') query = query.where('status', '!=', 'resolved');
    else if (filter !== 'all') query = query.where('status', '=', filter);
    const rows = await query.orderBy('updated_at', 'desc').limit(500).execute();
    return rows.map(toAdminTicket);
  }

  async get(
    ticketId: string,
  ): Promise<{ ticket: AdminDeskTicket; context: SupportContext; messages: DeskMessage[] } | null> {
    const row = await this.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      ticket: toAdminTicket(row),
      context: sanitizeSupportContext(json.decode(row.context)),
      messages: await this.messagesOf(ticketId),
    };
  }

  async answer(ticketId: string, message: string, authorName: string | null): Promise<boolean> {
    return this.database.transaction(async () => {
      const row = await this.db
        .selectFrom('support_tickets')
        .select(['id', 'status'])
        .where('id', '=', ticketId)
        .executeTakeFirst();
      if (!row) return false;
      const now = this.clock.now();
      await this.insertMessage(ticketId, 'support', authorName, message, now);
      // Answered: the ticket waits on the pilot, unless it is parked or closed on purpose.
      const status = row.status === 'new' || row.status === 'open' ? 'pending' : row.status;
      await this.db
        .updateTable('support_tickets')
        .set((eb) => ({
          status,
          preview: message.slice(0, PREVIEW),
          message_count: eb('message_count', '+', 1),
          unread_customer: eb('unread_customer', '+', 1),
          unread_team: 0,
          updated_at: now,
          last_message_at: now,
        }))
        .where('id', '=', ticketId)
        .execute();
      return true;
    });
  }

  async update(
    ticketId: string,
    change: { status?: SupportTicketStatus | undefined; priority?: SupportPriority | undefined },
  ): Promise<AdminDeskTicket | null> {
    const set: Partial<TicketRow> = { updated_at: this.clock.now() };
    if (change.status) set.status = change.status;
    if (change.priority) set.priority = change.priority;
    await this.db.updateTable('support_tickets').set(set).where('id', '=', ticketId).execute();
    const row = await this.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .executeTakeFirst();
    return row ? toAdminTicket(row) : null;
  }

  async ownerOf(ticketId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('support_tickets')
      .select('distinct_id')
      .where('id', '=', ticketId)
      .executeTakeFirst();
    return row?.distinct_id ?? null;
  }

  // ---- Feedback ----

  async send(submission: FeedbackSubmission): Promise<void> {
    await this.db
      .insertInto('support_feedback')
      .values({
        id: submission.id,
        kind: submission.kind,
        rating: submission.rating,
        text: submission.text,
        distinct_id: submission.identity?.distinctId ?? null,
        character_id: submission.identity?.characterId ?? null,
        character_name: submission.identity?.characterName ?? null,
        context: json.encode(submission.context),
        created_at: submission.at,
      })
      .execute();
  }

  async feedback(limit: number): Promise<FeedbackRecord[]> {
    const rows = await this.db
      .selectFrom('support_feedback')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind === 'feature' ? 'feature' : 'quick',
      rating: r.rating === null ? null : Number(r.rating),
      text: r.text,
      characterId: r.character_id === null ? null : Number(r.character_id),
      characterName: r.character_name,
      createdAt: Number(r.created_at),
    }));
  }

  private async owned(identity: SupportIdentity, ticketId: string): Promise<TicketRow | undefined> {
    return this.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .where('distinct_id', '=', identity.distinctId)
      .executeTakeFirst();
  }

  private async messagesOf(ticketId: string): Promise<DeskMessage[]> {
    const rows = await this.db
      .selectFrom('support_messages')
      .selectAll()
      .where('ticket_id', '=', ticketId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map((m) => ({
      id: m.id,
      body: m.body,
      author: m.author === 'support' ? 'support' : 'customer',
      authorName: m.author_name,
      createdAt: Number(m.created_at),
    }));
  }

  private async insertMessage(
    ticketId: string,
    author: 'customer' | 'support',
    authorName: string | null,
    body: string,
    at: number,
  ): Promise<void> {
    await this.db
      .insertInto('support_messages')
      .values({ id: newId(), ticket_id: ticketId, author, author_name: authorName, body, created_at: at })
      .execute();
  }
}

function toTicket(row: TicketRow): DeskTicket {
  return {
    id: row.id,
    number: Number(row.number),
    category: SupportCategory.safeParse(row.category).data ?? null,
    status: SupportTicketStatus.safeParse(row.status).data ?? 'open',
    unread: Number(row.unread_customer),
    preview: row.preview,
    lastMessageAt: row.last_message_at === null ? null : Number(row.last_message_at),
    createdAt: Number(row.created_at),
    messageCount: Number(row.message_count),
  };
}

function toAdminTicket(row: TicketRow): AdminDeskTicket {
  return {
    ...toTicket(row),
    // On the inbox, "unread" is what the team has not seen yet.
    unread: Number(row.unread_team),
    characterId: Number(row.character_id),
    characterName: row.character_name,
    priority: SupportPriority.safeParse(row.priority).data ?? 'medium',
  };
}
