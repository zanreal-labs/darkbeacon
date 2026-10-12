import type { Session } from '../domain/account.js';

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;
  /** Live and expired sessions of the account, most recently used first. */
  listForAccount(accountId: string): Promise<Session[]>;
  touch(id: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  delete(id: string): Promise<void>;
  /** "Log out everywhere". */
  deleteForAccount(accountId: string): Promise<number>;
  deleteExpired(now: number): Promise<number>;
}
