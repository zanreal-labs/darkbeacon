import { ManualClock, type DomainEvent, type EventLog, type NewEvent } from '@darkbeacon/core';
import type { SupportCategory, SupportContext } from '@darkbeacon/shared';
import type { SupportIdentity, SupportIdentityRecord } from '../domain/identity.js';
import type {
  AccountCharacter,
  DeskThread,
  DeskTicket,
  FeedbackSink,
  FeedbackSubmission,
  StoredHandle,
  SupportCrypto,
  SupportAccounts,
  SupportDesk,
  SupportHandleStore,
  SupportIdentityStore,
  SupportLimiter,
  TicketNotes,
} from '../ports/index.js';
import { SupportHub } from './hub.js';

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export class MemoryDesk implements SupportDesk {
  readonly backend = 'posthog' as const;
  readonly tickets = new Map<string, DeskThread & { owner: string; context: SupportContext }>();
  calls = { list: 0, thread: 0 };

  createTicket(
    identity: SupportIdentity,
    input: { category: SupportCategory; message: string; context: SupportContext },
  ) {
    const id = uuid();
    const ticket: DeskTicket = {
      id,
      number: this.tickets.size + 1,
      category: null,
      status: 'new',
      unread: 0,
      preview: input.message,
      lastMessageAt: 1,
      createdAt: this.tickets.size + 1,
      messageCount: 1,
    };
    this.tickets.set(id, {
      ticket,
      owner: identity.distinctId,
      context: input.context,
      messages: [{ id: uuid(), body: input.message, author: 'customer', authorName: null, createdAt: 1 }],
    });
    return Promise.resolve({ id });
  }

  listTickets(identity: SupportIdentity) {
    this.calls.list++;
    return Promise.resolve(
      [...this.tickets.values()].filter((t) => t.owner === identity.distinctId).map((t) => ({ ...t.ticket })),
    );
  }

  thread(identity: SupportIdentity, ticketId: string) {
    this.calls.thread++;
    const t = this.tickets.get(ticketId);
    return Promise.resolve(
      t && t.owner === identity.distinctId ? { ticket: { ...t.ticket }, messages: [...t.messages] } : null,
    );
  }

  reply(identity: SupportIdentity, ticketId: string, message: string) {
    const t = this.tickets.get(ticketId);
    if (!t || t.owner !== identity.distinctId) return Promise.resolve(false);
    t.messages.push({ id: uuid(), body: message, author: 'customer', authorName: null, createdAt: 2 });
    return Promise.resolve(true);
  }

  markRead(identity: SupportIdentity, ticketId: string) {
    const t = this.tickets.get(ticketId);
    if (!t || t.owner !== identity.distinctId) return Promise.resolve(false);
    t.ticket.unread = 0;
    return Promise.resolve(true);
  }

  /** Staff answer in PostHog. */
  answer(ticketId: string, body: string): void {
    const t = this.tickets.get(ticketId)!;
    t.messages.push({ id: uuid(), body, author: 'support', authorName: 'Zan', createdAt: 3 });
    t.ticket.unread++;
  }
}

/** The app's accounts as the hub sees them: linked characters with the owner hash the app keeps. */
export class MemoryAccounts implements SupportAccounts {
  readonly linked = new Map<string, Array<Omit<AccountCharacter, 'main'>>>();
  readonly mains = new Map<string, number>();

  link(accountId: string, character: Omit<AccountCharacter, 'main'>, main = false): void {
    // A character belongs to one account: linking it elsewhere takes it away (a sale).
    for (const [id, list] of this.linked)
      this.linked.set(
        id,
        list.filter((c) => c.characterId !== character.characterId),
      );
    this.linked.set(accountId, [...(this.linked.get(accountId) ?? []), character]);
    if (main) this.mains.set(accountId, character.characterId);
  }

  characters(accountId: string) {
    const list = this.linked.get(accountId) ?? [];
    const main = list.some((c) => c.characterId === this.mains.get(accountId))
      ? this.mains.get(accountId)
      : list[0]?.characterId;
    return Promise.resolve(
      list
        .map((c) => ({ ...c, main: c.characterId === main }))
        .sort((a, b) => Number(b.main) - Number(a.main)),
    );
  }
}

export class MemoryIdentities implements SupportIdentityStore {
  readonly records: SupportIdentityRecord[] = [];
  ofCharacter(characterId: number) {
    return Promise.resolve(this.records.filter((r) => r.characterId === characterId));
  }
  save(record: SupportIdentityRecord) {
    const i = this.records.findIndex(
      (r) => r.characterId === record.characterId && r.ownerHash === record.ownerHash,
    );
    if (i >= 0) this.records[i] = record;
    else this.records.push(record);
    return Promise.resolve();
  }
}

export class MemoryHandles implements SupportHandleStore {
  readonly rows: Array<StoredHandle & { tokenHash: string }> = [];
  create(handle: StoredHandle & { tokenHash: string }) {
    this.rows.push(handle);
    return Promise.resolve();
  }
  byTokenHash(tokenHash: string) {
    return Promise.resolve(this.rows.find((r) => r.tokenHash === tokenHash) ?? null);
  }
  ofAccount(accountId: string) {
    return Promise.resolve(this.rows.filter((r) => r.accountId === accountId));
  }
  revoke(accountId: string, id: string) {
    const i = this.rows.findIndex((r) => r.id === id && r.accountId === accountId);
    if (i < 0) return Promise.resolve(false);
    this.rows.splice(i, 1);
    return Promise.resolve(true);
  }
  touch(id: string, at: number) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.lastUsedAt = at;
    return Promise.resolve();
  }
}

export class MemoryNotes implements TicketNotes {
  readonly notes = new Map<string, SupportCategory>();
  save(ticketId: string, note: { category: SupportCategory }) {
    this.notes.set(ticketId, note.category);
    return Promise.resolve();
  }
  categories(ids: readonly string[]) {
    return Promise.resolve(
      new Map(ids.filter((id) => this.notes.has(id)).map((id) => [id, this.notes.get(id)!])),
    );
  }
}

export class MemoryFeedback implements FeedbackSink {
  readonly sent: FeedbackSubmission[] = [];
  send(submission: FeedbackSubmission) {
    this.sent.push(submission);
    return Promise.resolve();
  }
}

export class MemoryEvents implements EventLog {
  readonly appended: NewEvent[] = [];
  append(events: readonly NewEvent[]) {
    this.appended.push(...events);
    return Promise.resolve([] as DomainEvent[]);
  }
  readSince() {
    return Promise.resolve([]);
  }
  headSeq() {
    return Promise.resolve(0);
  }
  oldestSeq() {
    return Promise.resolve(null);
  }
  prune() {
    return Promise.resolve(0);
  }
}

/** Counts per key; refuses past the limit (no refill: tests advance nothing). */
export class CountingLimiter implements SupportLimiter {
  readonly counts = new Map<string, number>();
  take(key: string, limit: number) {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= limit;
  }
}

export const testCrypto: SupportCrypto = {
  randomToken: () => 'A'.repeat(20) + String(++counter).padStart(23, '0'),
  sha256Hex: (value) => `h(${value})`,
  uuid,
};

export function hubFixture(over: { feedback?: FeedbackSink | null } = {}) {
  const desk = new MemoryDesk();
  const accounts = new MemoryAccounts();
  const identities = new MemoryIdentities();
  const handles = new MemoryHandles();
  const notes = new MemoryNotes();
  const feedback = new MemoryFeedback();
  const events = new MemoryEvents();
  const limiter = new CountingLimiter();
  const clock = new ManualClock();
  const hub = new SupportHub({
    desk,
    feedback: over.feedback === undefined ? feedback : over.feedback,
    accounts,
    identities,
    handles,
    notes,
    crypto: testCrypto,
    limiter,
    events,
    clock,
  });
  return { hub, desk, accounts, identities, handles, notes, feedback, events, limiter, clock };
}
