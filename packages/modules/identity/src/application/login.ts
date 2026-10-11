import { ConflictError, NotFoundError, ValidationError, type Clock, type UnitOfWork } from '@wormwright/core';
import type { DevLoginRequest } from '@wormwright/shared';
import type { Account } from '../domain/account.js';
import type { PendingAuth } from '../domain/pending-auth.js';
import { devCharacterId } from '../domain/rules.js';
import type { CharacterRepository } from '../ports/character-repository.js';
import type { IdentityProvider } from '../ports/identity-provider.js';
import type { AccountService } from './accounts.js';
import type { GuildRoleSync } from './guild-roles.js';
import { asAuthFailure, beginPendingAuth, checkPendingAuth, requireConfigured } from './pending.js';
import type { SessionService } from './sessions.js';

export interface SignedIn {
  /** Session token for the cookie. */
  token: string;
  account: Account;
  returnTo: string;
}

export interface DiscordLoginDeps {
  discord: IdentityProvider | null;
  accounts: AccountService;
  guildRoles: GuildRoleSync;
  sessions: SessionService;
  clock: Clock;
  redirectUri: string;
}

/** Sign in with Discord: authorization code with state and PKCE. */
export class DiscordLogin {
  constructor(private readonly deps: DiscordLoginDeps) {}

  get enabled(): boolean {
    return this.deps.discord !== null;
  }

  async start(returnTo: unknown): Promise<{ url: string; pending: PendingAuth }> {
    const discord = requireConfigured(this.deps.discord, 'Discord');
    const { pending, codeChallenge } = await beginPendingAuth(this.deps.clock, {
      kind: 'discord',
      accountId: null,
      returnTo,
    });
    const url = discord.authorizationUrl({
      state: pending.state,
      redirectUri: this.deps.redirectUri,
      codeChallenge,
    });
    return { url, pending };
  }

  async complete(input: {
    code: string | undefined;
    state: string | undefined;
    pending: PendingAuth | null;
    userAgent: string | null;
  }): Promise<SignedIn> {
    const discord = requireConfigured(this.deps.discord, 'Discord');
    const pending = checkPendingAuth(this.deps.clock, 'discord', input.pending, input.state);
    if (!input.code) throw new ValidationError('Discord did not return an authorization code');
    const grant = await asAuthFailure(
      discord.exchangeCode({
        code: input.code,
        redirectUri: this.deps.redirectUri,
        codeVerifier: pending.codeVerifier,
      }),
    );
    const account = await this.deps.accounts.upsertDiscordAccount(grant.profile);
    try {
      await this.deps.guildRoles.saveGrant(account.id, grant);
    } catch {
      // Roles are retried in the background; a Discord hiccup must not block the login.
    }
    const { token } = await this.deps.sessions.create(account.id, input.userAgent);
    return { token, account, returnTo: pending.returnTo };
  }
}

export interface DevLoginDeps {
  enabled: boolean;
  accounts: AccountService;
  characters: CharacterRepository;
  sessions: SessionService;
  uow: UnitOfWork;
  clock: Clock;
}

/** Placeholder corporation of dev-login characters (an NPC school corporation). */
const DEV_CORPORATION_ID = 1000169;

/** `DEV_LOGIN=true`: signs in a named local account, optionally with a fake character. */
export class DevLogin {
  constructor(private readonly deps: DevLoginDeps) {}

  get enabled(): boolean {
    return this.deps.enabled;
  }

  async signIn(request: DevLoginRequest, userAgent: string | null): Promise<SignedIn> {
    if (!this.deps.enabled) throw new NotFoundError('Dev sign-in');
    const account = await this.deps.accounts.devAccount(request.name);
    const fake = request.character;
    if (fake) {
      await this.deps.uow.transaction(async () => {
        const id = fake.id ?? devCharacterId(fake.name);
        const existing = await this.deps.characters.findById(id);
        if (existing && existing.accountId !== account.id) {
          throw new ConflictError(`${existing.name} is already linked to another account`);
        }
        const now = this.deps.clock.now();
        await this.deps.characters.upsert({
          id,
          accountId: account.id,
          name: fake.name,
          corporationId: fake.corporationId ?? existing?.corporationId ?? DEV_CORPORATION_ID,
          allianceId: fake.allianceId !== undefined ? fake.allianceId : (existing?.allianceId ?? null),
          ownerHash: 'dev',
          tokenValid: true,
          linkedAt: existing?.linkedAt ?? now,
          updatedAt: now,
        });
      });
    }
    const { token } = await this.deps.sessions.create(account.id, userAgent);
    return { token, account, returnTo: '/' };
  }
}
