import type {
  SupportBackend,
  SupportCategory,
  SupportContext,
  SupportFeedbackKind,
  SupportPriority,
  SupportTicketStatus,
} from '@darkbeacon/shared';
import type { CharacterOwner, SupportIdentity, SupportIdentityRecord } from '../domain/identity.js';

export type { Clock, EventLog } from '@darkbeacon/core';

/** A ticket as a desk lists it. */
export interface DeskTicket {
  id: string;
  /** The desk's own running number (PostHog's ticket number, the hub store's sequence). */
  number: number | null;
  /** Null where the desk does not keep it (PostHog); the hub fills it from its own notes. */
  category: SupportCategory | null;
  status: SupportTicketStatus;
  /** Replies the pilot has not read yet. */
  unread: number;
  preview: string | null;
  lastMessageAt: number | null;
  createdAt: number;
  messageCount: number;
}

export interface DeskMessage {
  id: string;
  body: string;
  author: 'customer' | 'support';
  authorName: string | null;
  createdAt: number;
}

export interface DeskThread {
  ticket: DeskTicket;
  messages: DeskMessage[];
}

/**
 * Where tickets live: PostHog Support (through its widget API, server-side) or the hub's own
 * tables. Both answer only for the identity's own tickets: a ticket of someone else is the same
 * as no ticket (null / false).
 */
export interface SupportDesk {
  readonly backend: SupportBackend;
  createTicket(
    identity: SupportIdentity,
    input: { category: SupportCategory; message: string; context: SupportContext },
  ): Promise<{ id: string }>;
  listTickets(identity: SupportIdentity): Promise<DeskTicket[]>;
  thread(identity: SupportIdentity, ticketId: string): Promise<DeskThread | null>;
  reply(identity: SupportIdentity, ticketId: string, message: string): Promise<boolean>;
  markRead(identity: SupportIdentity, ticketId: string): Promise<boolean>;
}

export interface AdminDeskTicket extends DeskTicket {
  characterId: number;
  characterName: string;
  priority: SupportPriority;
}

export interface FeedbackRecord {
  id: string;
  kind: SupportFeedbackKind;
  rating: number | null;
  text: string;
  characterId: number | null;
  characterName: string | null;
  createdAt: number;
}

/** The hub's own store, seen by its instance admins (the PostHog desk is answered in PostHog). */
export interface SupportAdminDesk {
  list(filter: SupportTicketStatus | 'all' | 'active'): Promise<AdminDeskTicket[]>;
  get(
    ticketId: string,
  ): Promise<{ ticket: AdminDeskTicket; context: SupportContext; messages: DeskMessage[] } | null>;
  /** The answer counts as unread for the pilot. False when there is no such ticket. */
  answer(ticketId: string, message: string, authorName: string | null): Promise<boolean>;
  update(
    ticketId: string,
    change: { status?: SupportTicketStatus | undefined; priority?: SupportPriority | undefined },
  ): Promise<AdminDeskTicket | null>;
  feedback(limit: number): Promise<FeedbackRecord[]>;
  /** The identity a ticket belongs to (to refresh its cached list after an answer). */
  ownerOf(ticketId: string): Promise<string | null>;
}

/** One answer to a survey, as it leaves the hub. */
export interface FeedbackSubmission {
  id: string;
  kind: SupportFeedbackKind;
  rating: number | null;
  text: string;
  /** Null: anonymous (no person profile is made). */
  identity: SupportIdentity | null;
  context: Pick<SupportContext, 'appVersion' | 'page' | 'viewport'>;
  at: number;
}

/** Where feedback goes: PostHog surveys, or the hub's own table. */
export interface FeedbackSink {
  send(submission: FeedbackSubmission): Promise<void>;
}

/** A linked EVE character of an account on the hub. */
export interface AccountCharacter extends CharacterOwner {
  /** The account's main character (or its first one when no main is set). */
  main: boolean;
}

/**
 * The hub's accounts: pilots sign in to the hub as to any instance (the app's own session), and
 * their tickets belong to the EVE characters linked to that account.
 */
export interface SupportAccounts {
  /** The account's linked characters, main first; empty for an account that linked none. */
  characters(accountId: string): Promise<AccountCharacter[]>;
}

/** Every owner the hub has seen per character. */
export interface SupportIdentityStore {
  ofCharacter(characterId: number): Promise<SupportIdentityRecord[]>;
  save(record: SupportIdentityRecord, at: number): Promise<void>;
}

/** What the hub notes itself about tickets a desk does not keep (the category on PostHog). */
export interface TicketNotes {
  save(
    ticketId: string,
    note: { distinctId: string; category: SupportCategory; createdAt: number },
  ): Promise<void>;
  categories(ticketIds: readonly string[]): Promise<Map<string, SupportCategory>>;
}

export interface StoredHandle {
  id: string;
  /** The hub account it shows the unread answers of (every character of it). */
  accountId: string;
  origin: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Unread handles: kept as a hash of the token, never the token. */
export interface SupportHandleStore {
  create(handle: StoredHandle & { tokenHash: string }): Promise<void>;
  byTokenHash(tokenHash: string): Promise<StoredHandle | null>;
  ofAccount(accountId: string): Promise<StoredHandle[]>;
  /** False when there is no such handle of this account. */
  revoke(accountId: string, id: string): Promise<boolean>;
  touch(id: string, at: number): Promise<void>;
}

/** Instance side: the handle the hub gave an account. */
export interface ClientHandleStore {
  get(accountId: string): Promise<{ hubOrigin: string; handle: string } | null>;
  set(accountId: string, value: { hubOrigin: string; handle: string }, at: number): Promise<void>;
  clear(accountId: string): Promise<void>;
}

export interface SupportCrypto {
  /** Random bytes as base64url. */
  randomToken(bytes: number): string;
  sha256Hex(value: string): string;
  /** A random UUID (v4). */
  uuid(): string;
}

/** Token buckets: true when the action may go ahead now. */
export interface SupportLimiter {
  take(key: string, limit: number, perMinutes: number): boolean;
}
