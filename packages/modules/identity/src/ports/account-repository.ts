import type { Account } from '../domain/account.js';

export interface AccountRepository {
  findById(id: string): Promise<Account | null>;
  findByDiscordId(discordId: string): Promise<Account | null>;
  /** Dev-login accounts (no Discord id) are looked up by name. */
  findByName(name: string): Promise<Account | null>;
  list(): Promise<Account[]>;
  /** Accounts whose name contains `text` (case-insensitive), names starting with it first. */
  search(text: string, limit: number): Promise<Account[]>;
  count(): Promise<number>;
  /** Fails when a second owner would be stored (unique per instance). */
  insert(account: Account): Promise<void>;
  update(account: Account): Promise<void>;
  /** Sets `lastSeenAt` only, so it never overwrites a concurrent role change. */
  touch(id: string, lastSeenAt: number): Promise<void>;
  /** Sets the recently opened maps only (written on every map visit). */
  setRecentMaps(id: string, recentMapIds: string[]): Promise<void>;
}
