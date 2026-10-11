import type { Account } from '../domain/account.js';

export interface AccountRepository {
  findById(id: string): Promise<Account | null>;
  findByDiscordId(discordId: string): Promise<Account | null>;
  /** Dev-login accounts are looked up by name. */
  findByName(name: string): Promise<Account | null>;
  list(): Promise<Account[]>;
  count(): Promise<number>;
  insert(account: Account): Promise<void>;
  update(account: Account): Promise<void>;
}
