import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  requireAccount,
  ValidationError,
  type Actor,
  type Clock,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { DevLoginRequest } from '@darkbeacon/shared';
import type { Account } from '../domain/account.js';
import type { PendingAuth } from '../domain/pending-auth.js';
import { devCharacterId } from '../domain/rules.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { CharacterRepository } from '../ports/character-repository.js';
import type { DiscordGrant, IdentityProvider } from '../ports/identity-provider.js';
import type { LoginPolicy } from '../ports/login-policy.js';
import type { AccountService } from './accounts.js';
import type { CharacterService } from './characters.js';
import type { GuildRoleSync } from './guild-roles.js';
import { asAuthFailure, beginPendingAuth, checkPendingAuth, requireConfigured } from './pending.js';
import type { SessionService } from './sessions.js';
import type { SignUpGate } from './sign-up.js';

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
  /** Without one, Discord is the login method. */
  loginPolicy?: LoginPolicy;
  accountRepository?: AccountRepository;
  /** Who may get a new account; without one, anyone. */
  signUp?: SignUpGate;
  clock: Clock;
  redirectUri: string;
}

/** Sign in with Discord: authorization code with state and PKCE. */
export class DiscordLogin {
  constructor(private readonly deps: DiscordLoginDeps) {}

  get enabled(): boolean {
    return this.deps.discord !== null;
  }

  async start(returnTo: unknown, invite?: unknown): Promise<{ url: string; pending: PendingAuth }> {
    const discord = requireConfigured(this.deps.discord, 'Discord');
    const { pending, codeChallenge } = await beginPendingAuth(this.deps.clock, {
      kind: 'discord',
      accountId: null,
      returnTo,
      invite,
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
    // With EVE sign-in, Discord opens only accounts it was connected to (keeping their names);
    // it never creates one.
    let account: Account;
    if ((await this.deps.loginPolicy?.loginMethod()) === 'eve') {
      const known = await this.deps.accountRepository?.findByDiscordId(grant.profile.id);
      if (!known) {
        throw new ForbiddenError(
          'Sign in with EVE Online. Discord can be connected on your account page afterwards.',
        );
      }
      account = known;
    } else {
      const known = await this.deps.accountRepository?.findByDiscordId(grant.profile.id);
      // A new person: sign-up may be restricted (allowed servers, invites).
      const gate =
        known || !this.deps.signUp
          ? null
          : await this.deps.signUp.check({
              discordAccessToken: grant.accessToken,
              invite: pending.invite ?? null,
            });
      account = await this.deps.accounts.upsertDiscordAccount(grant.profile);
      if (gate) await this.deps.signUp!.used(gate.inviteId, account.id);
    }
    await this.saveGrant(account.id, grant);
    const { token } = await this.deps.sessions.create(account.id, input.userAgent);
    return { token, account, returnTo: pending.returnTo };
  }

  /** Starts connecting a Discord user to the signed-in account. */
  async startConnect(actor: Actor | null, returnTo: unknown): Promise<{ url: string; pending: PendingAuth }> {
    const account = requireAccount(actor);
    const discord = requireConfigured(this.deps.discord, 'Discord');
    const { pending, codeChallenge } = await beginPendingAuth(this.deps.clock, {
      kind: 'discord-connect',
      accountId: account.id,
      returnTo,
    });
    const url = discord.authorizationUrl({
      state: pending.state,
      redirectUri: this.deps.redirectUri,
      codeChallenge,
    });
    return { url, pending };
  }

  /** Finishes connecting: the Discord user joins the account that started the round trip. */
  async completeConnect(
    actor: Actor | null,
    input: { code: string | undefined; state: string | undefined; pending: PendingAuth | null },
  ): Promise<{ account: Account; returnTo: string }> {
    const caller = requireAccount(actor);
    const discord = requireConfigured(this.deps.discord, 'Discord');
    const pending = checkPendingAuth(this.deps.clock, 'discord-connect', input.pending, input.state);
    if (pending.accountId !== caller.id) throw new ForbiddenError('This was started by another account');
    if (!input.code) throw new ValidationError('Discord did not return an authorization code');
    const grant = await asAuthFailure(
      discord.exchangeCode({
        code: input.code,
        redirectUri: this.deps.redirectUri,
        codeVerifier: pending.codeVerifier,
      }),
    );
    const account = await this.deps.accounts.connectDiscord(caller.id, grant.profile);
    await this.saveGrant(account.id, grant);
    return { account, returnTo: pending.returnTo };
  }

  private async saveGrant(accountId: string, grant: DiscordGrant): Promise<void> {
    try {
      await this.deps.guildRoles.saveGrant(accountId, grant);
    } catch {
      // Roles are retried in the background; a Discord hiccup must not block the login.
    }
  }
}

export interface EveLoginDeps {
  characters: CharacterService;
  accounts: AccountService;
  sessions: SessionService;
  loginPolicy: LoginPolicy;
  /** Who may get a new account; without one, anyone. */
  signUp?: SignUpGate;
}

/**
 * Sign in with EVE Online (instances whose login method is `eve`). The rules, also in
 * docs/decisions.md: the first sign-in of a character creates an account for it; characters
 * linked while signed in join that account; signing in with any linked character (main or alt)
 * opens its account; an unknown character signing in while signed out creates a new account.
 */
export class EveLogin {
  constructor(private readonly deps: EveLoginDeps) {}

  get configured(): boolean {
    return this.deps.characters.enabled;
  }

  async start(returnTo: unknown, invite?: unknown): Promise<{ url: string; pending: PendingAuth }> {
    await this.requireEveLogin();
    return this.deps.characters.startSignIn(returnTo, invite);
  }

  async complete(
    actor: Actor | null,
    input: {
      code: string | undefined;
      state: string | undefined;
      pending: PendingAuth | null;
      userAgent: string | null;
    },
  ): Promise<SignedIn & { created: boolean }> {
    await this.requireEveLogin();
    const result = await this.deps.characters.completeSignIn(input, {
      signedInAccountId: actor?.kind === 'account' ? actor.id : null,
      createAccount: async (character, invite) => {
        // A new person: sign-up may be restricted (allowed corporations and alliances, invites).
        const gate = await this.deps.signUp?.check({ characters: [character], invite });
        const account = await this.deps.accounts.createForCharacter(character);
        if (gate) await this.deps.signUp!.used(gate.inviteId, account.id);
        return account;
      },
    });
    const account = await this.deps.accounts.find(result.accountId);
    if (!account) throw new NotFoundError('Account');
    const { token } = await this.deps.sessions.create(account.id, input.userAgent);
    return { token, account, returnTo: result.returnTo, created: result.created };
  }

  private async requireEveLogin(): Promise<void> {
    if ((await this.deps.loginPolicy.loginMethod()) !== 'eve') {
      throw new ForbiddenError('This instance signs people in with Discord');
    }
  }
}

export interface DemoLoginDeps {
  enabled: boolean;
  accounts: AccountService;
  characters: CharacterRepository;
  sessions: SessionService;
  uow: UnitOfWork;
  clock: Clock;
}

/** Placeholder corporation of demo characters (an NPC school corporation). */
const DEMO_CORPORATION_ID = 1000169;

/** Name of the account a demo visit is signed in as. */
export const DEMO_ACCOUNT_NAME = 'Demo pilot';
/** Fake characters of the demo account; the first one is its main. */
export const DEMO_CHARACTERS: readonly string[] = ['Ayla Vex', 'Torren Kade'];

type FakeCharacter = NonNullable<DevLoginRequest['character']>;

/**
 * `DEMO_MODE=true` (formerly `DEV_LOGIN`): local previews without Discord or EVE.
 * `signInDemo` is what the web app calls for an unauthenticated visit; `signIn` signs in any named
 * local account (scripts and tests that need several people).
 */
export class DemoLogin {
  constructor(private readonly deps: DemoLoginDeps) {}

  get enabled(): boolean {
    return this.deps.enabled;
  }

  /** The demo account (owner on a fresh instance) with two fake characters, the first one as main. */
  async signInDemo(userAgent: string | null): Promise<SignedIn> {
    if (!this.deps.enabled) throw new NotFoundError('Demo access');
    let account = await this.deps.accounts.devAccount(DEMO_ACCOUNT_NAME);
    for (const name of DEMO_CHARACTERS) await this.attach(account, { name });
    if (account.mainCharacterId == null) {
      const actor = await this.deps.accounts.actorFor(account);
      await this.deps.accounts.setMainCharacter(actor, devCharacterId(DEMO_CHARACTERS[0]!));
      account = { ...account, mainCharacterId: devCharacterId(DEMO_CHARACTERS[0]!) };
    }
    const { token } = await this.deps.sessions.create(account.id, userAgent);
    return { token, account, returnTo: '/' };
  }

  async signIn(request: DevLoginRequest, userAgent: string | null): Promise<SignedIn> {
    if (!this.deps.enabled) throw new NotFoundError('Demo access');
    const account = await this.deps.accounts.devAccount(request.name);
    if (request.character) await this.attach(account, request.character);
    const { token } = await this.deps.sessions.create(account.id, userAgent);
    return { token, account, returnTo: '/' };
  }

  private async attach(account: Account, fake: FakeCharacter): Promise<void> {
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
        corporationId: fake.corporationId ?? existing?.corporationId ?? DEMO_CORPORATION_ID,
        allianceId: fake.allianceId !== undefined ? fake.allianceId : (existing?.allianceId ?? null),
        ownerHash: 'dev',
        tokenValid: true,
        linkedAt: existing?.linkedAt ?? now,
        updatedAt: now,
      });
    });
  }
}
