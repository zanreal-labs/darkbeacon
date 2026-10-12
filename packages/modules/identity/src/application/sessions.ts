import { ForbiddenError, NotFoundError, type Clock, type EventLog } from '@darkbeacon/core';

const DISABLED = 'This account is disabled. Ask an admin of this instance.';
import type { SessionDto } from '@darkbeacon/shared';
import type { Account, Session } from '../domain/account.js';
import { describeUserAgent, SESSION_TOUCH_MS, SESSION_TTL_MS } from '../domain/rules.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import { randomToken, sha256 } from './crypto.js';
import { accountChanged } from './events.js';

export interface SessionDeps {
  sessions: SessionRepository;
  accounts: AccountRepository;
  events: EventLog;
  clock: Clock;
}

/**
 * Server-side sessions. The client holds a random token in an httpOnly cookie; the table keeps
 * only its hash, so a leaked database does not leak live sessions. Sessions slide on use.
 */
export class SessionService {
  constructor(private readonly deps: SessionDeps) {}

  async create(accountId: string, userAgent: string | null): Promise<{ token: string; session: Session }> {
    if ((await this.deps.accounts.findById(accountId))?.disabledAt) throw new ForbiddenError(DISABLED);
    const token = randomToken();
    const now = this.deps.clock.now();
    const session: Session = {
      id: await sha256(token),
      accountId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
      userAgent: userAgent?.slice(0, 256) ?? null,
    };
    await this.deps.sessions.insert(session);
    await this.deps.accounts.touch(accountId, now);
    return { token, session };
  }

  /** The live session and account behind a cookie token, or null. */
  async resolve(token: string | null | undefined): Promise<{ session: Session; account: Account } | null> {
    if (!token) return null;
    const session = await this.deps.sessions.findById(await sha256(token));
    if (!session) return null;
    const now = this.deps.clock.now();
    if (session.expiresAt <= now) {
      await this.deps.sessions.delete(session.id);
      return null;
    }
    const account = await this.deps.accounts.findById(session.accountId);
    // A disabled account's sessions are dead (they are deleted too, when it is disabled).
    if (!account || account.disabledAt) return null;
    if (now - session.lastSeenAt >= SESSION_TOUCH_MS) {
      await this.deps.sessions.touch(session.id, now, now + SESSION_TTL_MS);
      await this.deps.accounts.touch(account.id, now);
    }
    return { session, account };
  }

  /** Ends one session; open sockets of the account re-check theirs (`access.account_changed`). */
  async logout(token: string | null | undefined): Promise<void> {
    if (!token) return;
    const session = await this.deps.sessions.findById(await sha256(token));
    if (!session) return;
    await this.deps.sessions.delete(session.id);
    await this.ended(session.accountId);
  }

  /** The account's live sessions, most recently used first; `token` marks the caller's own. */
  async list(accountId: string, token: string | null | undefined): Promise<SessionDto[]> {
    const now = this.deps.clock.now();
    const current = token ? await sha256(token) : null;
    const sessions = (await this.deps.sessions.listForAccount(accountId)).filter((s) => s.expiresAt > now);
    return Promise.all(
      sessions.map(async (s) => ({
        id: await publicSessionId(s.id),
        ...describeUserAgent(s.userAgent),
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === current,
      })),
    );
  }

  /** Ends one of the account's sessions by its public id (from `list`). */
  async revoke(accountId: string, publicId: string): Promise<void> {
    for (const session of await this.deps.sessions.listForAccount(accountId)) {
      if ((await publicSessionId(session.id)) !== publicId) continue;
      await this.deps.sessions.delete(session.id);
      await this.ended(accountId);
      return;
    }
    throw new NotFoundError('Session');
  }

  /** "Log out everywhere": ends every session of the account. */
  async logoutEverywhere(accountId: string): Promise<number> {
    const ended = await this.deps.sessions.deleteForAccount(accountId);
    await this.ended(accountId);
    return ended;
  }

  private async ended(accountId: string): Promise<void> {
    const actor = { kind: 'account' as const, id: accountId };
    await this.deps.events.append([accountChanged(accountId, actor, this.deps.clock.now())]);
  }

  pruneExpired(): Promise<number> {
    return this.deps.sessions.deleteExpired(this.deps.clock.now());
  }
}

/**
 * What the browser sees of a session: a hash of the stored id (itself a hash of the cookie), so
 * neither the cookie nor the row key leaves the server.
 */
async function publicSessionId(storedId: string): Promise<string> {
  return (await sha256(`session:${storedId}`)).slice(0, 22);
}
