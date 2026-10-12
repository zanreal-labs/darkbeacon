// In-memory ports for unit tests of this module. Not part of the public API.
import type { DomainEvent, EventLog, NewEvent, UnitOfWork } from '@darkbeacon/core';
import type {
  Account,
  CharacterTokens,
  DiscordLink,
  GuildRole,
  LinkedCharacter,
  Session,
} from '../domain/account.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { CharacterRepository } from '../ports/character-repository.js';
import type { DiscordGuildPolicy, DiscordLinkRepository } from '../ports/discord-link-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';

export class MemoryAccounts implements AccountRepository {
  readonly rows = new Map<string, Account>();

  findById(id: string) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  findByDiscordId(discordId: string) {
    return Promise.resolve([...this.rows.values()].find((a) => a.discordId === discordId) ?? null);
  }
  findByName(name: string) {
    return Promise.resolve([...this.rows.values()].find((a) => a.name === name && !a.discordId) ?? null);
  }
  list() {
    return Promise.resolve([...this.rows.values()]);
  }
  count() {
    return Promise.resolve(this.rows.size);
  }
  insert(account: Account) {
    if ([...this.rows.values()].some((a) => a.instanceRole === 'owner') && account.instanceRole === 'owner') {
      return Promise.reject(new Error('second owner'));
    }
    this.rows.set(account.id, account);
    return Promise.resolve();
  }
  update(account: Account) {
    this.rows.set(account.id, account);
    return Promise.resolve();
  }
  touch(id: string, lastSeenAt: number) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastSeenAt });
    return Promise.resolve();
  }
  search(text: string, limit: number) {
    const t = text.toLowerCase();
    return Promise.resolve(
      [...this.rows.values()]
        .filter((a) => a.name.toLowerCase().includes(t))
        .sort(
          (a, b) =>
            Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, limit),
    );
  }
  setRecentMaps(id: string, recentMapIds: string[]) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, recentMapIds });
    return Promise.resolve();
  }
}

export class MemorySessions implements SessionRepository {
  readonly rows = new Map<string, Session>();

  insert(session: Session) {
    this.rows.set(session.id, session);
    return Promise.resolve();
  }
  findById(id: string) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  listForAccount(accountId: string) {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((s) => s.accountId === accountId)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    );
  }
  touch(id: string, lastSeenAt: number, expiresAt: number) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastSeenAt, expiresAt });
    return Promise.resolve();
  }
  delete(id: string) {
    this.rows.delete(id);
    return Promise.resolve();
  }
  deleteForAccount(accountId: string) {
    let n = 0;
    for (const [id, s] of this.rows) if (s.accountId === accountId && this.rows.delete(id)) n++;
    return Promise.resolve(n);
  }
  deleteExpired(now: number) {
    let n = 0;
    for (const [id, s] of this.rows) if (s.expiresAt <= now && this.rows.delete(id)) n++;
    return Promise.resolve(n);
  }
}

export class MemoryCharacters implements CharacterRepository {
  readonly rows = new Map<number, LinkedCharacter>();
  readonly tokens = new Map<number, CharacterTokens>();

  findById(id: number) {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  listForAccount(accountId: string) {
    return Promise.resolve([...this.rows.values()].filter((c) => c.accountId === accountId));
  }
  upsert(character: LinkedCharacter) {
    this.rows.set(character.id, character);
    return Promise.resolve();
  }
  updateState(
    id: number,
    accountId: string,
    state: Partial<Pick<LinkedCharacter, 'corporationId' | 'allianceId' | 'tokenValid'>> & {
      updatedAt: number;
    },
  ) {
    const row = this.rows.get(id);
    if (row?.accountId !== accountId) return Promise.resolve(false);
    this.rows.set(id, { ...row, ...state });
    return Promise.resolve(true);
  }
  delete(id: number) {
    this.rows.delete(id);
    this.tokens.delete(id);
    return Promise.resolve();
  }
  saveTokens(id: number, tokens: CharacterTokens) {
    this.tokens.set(id, tokens);
    return Promise.resolve();
  }
  getTokens(id: number) {
    return Promise.resolve(this.tokens.get(id) ?? null);
  }
  scopesOf(ids: readonly number[]) {
    return Promise.resolve(
      new Map(ids.flatMap((id) => (this.tokens.has(id) ? [[id, this.tokens.get(id)!.scopes] as const] : []))),
    );
  }
}

export class MemoryDiscordLinks implements DiscordLinkRepository {
  readonly rows = new Map<string, DiscordLink>();

  find(accountId: string) {
    return Promise.resolve(this.rows.get(accountId) ?? null);
  }
  save(link: DiscordLink) {
    this.rows.set(link.accountId, link);
    return Promise.resolve();
  }
  remove(accountId: string) {
    this.rows.delete(accountId);
    return Promise.resolve();
  }
}

export class StaticGuildPolicy implements DiscordGuildPolicy {
  constructor(
    public guilds: string[] = [],
    public adminRoles: GuildRole[] = [],
  ) {}

  guildIds() {
    return Promise.resolve(this.guilds);
  }
  grantsAdmin(roles: ReadonlyArray<GuildRole>) {
    return Promise.resolve(
      roles.some((r) => this.adminRoles.some((a) => a.guildId === r.guildId && a.roleId === r.roleId)),
    );
  }
}

/** Runs work directly; enough for single-threaded unit tests. */
export const immediateUow: UnitOfWork = { transaction: (work) => work() };

export class MemoryEventLog implements EventLog {
  readonly events: DomainEvent[] = [];

  append(events: readonly NewEvent[]) {
    const stored = events.map((e) => ({ ...e, seq: this.events.length + 1, v: 1 as const }));
    this.events.push(...stored);
    return Promise.resolve(stored);
  }
  readSince() {
    return Promise.resolve([]);
  }
  headSeq() {
    return Promise.resolve(this.events.length);
  }
  oldestSeq() {
    return Promise.resolve(null);
  }
  prune() {
    return Promise.resolve(0);
  }
}
