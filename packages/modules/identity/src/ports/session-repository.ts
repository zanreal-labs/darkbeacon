import type { Session } from '../domain/account.js';

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;
  touch(id: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  delete(id: string): Promise<void>;
  /** "Log out everywhere". */
  deleteForAccount(accountId: string): Promise<number>;
  deleteExpired(now: number): Promise<number>;
}
