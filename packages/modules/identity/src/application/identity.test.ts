import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, type AccountActor } from '@wormwright/core';
import { ExternalAuthError } from '../domain/errors.js';
import { SESSION_TOUCH_MS, SESSION_TTL_MS, safeReturnTo, GUILD_ROLES_TTL_MS } from '../domain/rules.js';
import type { EveSso, EveTokenSet } from '../ports/eve-sso.js';
import type { DiscordGrant, IdentityProvider } from '../ports/identity-provider.js';
import {
  immediateUow,
  MemoryAccounts,
  MemoryCharacters,
  MemoryDiscordLinks,
  MemoryEventLog,
  MemorySessions,
  StaticGuildPolicy,
} from './testing.js';
import { AccountService } from './accounts.js';
import { CharacterService } from './characters.js';
import { pkceChallenge } from './crypto.js';
import { GuildRoleSync } from './guild-roles.js';
import { DevLogin, DiscordLogin } from './login.js';
import { SessionService } from './sessions.js';

class FakeDiscord implements IdentityProvider {
  readonly grants = new Map<string, DiscordGrant>();
  /** `${accessToken}|${guildId}` -> roles; missing = not a member. */
  readonly roles = new Map<string, string[]>();
  rejectTokens = false;
  refreshes = 0;
  lastChallenge: string | undefined;
  lastVerifier: string | undefined;

  authorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }) {
    this.lastChallenge = input.codeChallenge;
    return `https://discord.test/authorize?state=${input.state}`;
  }
  exchangeCode(input: { code: string; codeVerifier?: string }) {
    this.lastVerifier = input.codeVerifier;
    const grant = this.grants.get(input.code);
    return grant ? Promise.resolve(grant) : Promise.reject(new ExternalAuthError('discord', 'bad code'));
  }
  refresh(refreshToken: string) {
    this.refreshes++;
    if (this.rejectTokens) return Promise.reject(new ExternalAuthError('discord', 'revoked'));
    return Promise.resolve(grant('refreshed', `${refreshToken}+`, Date.UTC(2027, 0, 1)));
  }
  guildRoles(accessToken: string, guildId: string) {
    if (this.rejectTokens) return Promise.reject(new ExternalAuthError('discord', 'revoked'));
    return Promise.resolve(this.roles.get(`${accessToken}|${guildId}`) ?? null);
  }
}

function grant(
  accessToken: string,
  refreshToken = 'r',
  expiresAt = Date.UTC(2026, 6, 1),
  id = 'd1',
): DiscordGrant {
  return {
    profile: { id, username: `user${id}`, globalName: `User ${id}`, avatarUrl: null },
    accessToken,
    refreshToken,
    expiresAt,
  };
}

function setup() {
  const clock = new ManualClock();
  const accounts = new MemoryAccounts();
  const sessionsRepo = new MemorySessions();
  const characters = new MemoryCharacters();
  const discordLinks = new MemoryDiscordLinks();
  const guildPolicy = new StaticGuildPolicy();
  const events = new MemoryEventLog();
  const discord = new FakeDiscord();
  const accountService = new AccountService({
    accounts,
    characters,
    discordLinks,
    guildPolicy,
    uow: immediateUow,
    events,
    clock,
  });
  const sessions = new SessionService({ sessions: sessionsRepo, accounts, clock });
  const guildRoles = new GuildRoleSync({ discord, discordLinks, guildPolicy, clock });
  const discordLogin = new DiscordLogin({
    discord,
    accounts: accountService,
    guildRoles,
    sessions,
    clock,
    redirectUri: 'https://ww.test/api/auth/discord/callback',
  });
  const devLogin = new DevLogin({
    enabled: true,
    accounts: accountService,
    characters,
    sessions,
    uow: immediateUow,
    clock,
  });
  return {
    clock,
    accounts,
    sessionsRepo,
    characters,
    discordLinks,
    guildPolicy,
    events,
    discord,
    accountService,
    sessions,
    guildRoles,
    discordLogin,
    devLogin,
  };
}

const actorOf = (id: string, instanceRole: AccountActor['instanceRole'] = 'user'): AccountActor => ({
  kind: 'account',
  id,
  instanceRole,
});

describe('rules', () => {
  it('only accepts same-origin paths as return targets', () => {
    expect(safeReturnTo('/m/home?x=1')).toBe('/m/home?x=1');
    expect(safeReturnTo('//evil.test')).toBe('/');
    expect(safeReturnTo('https://evil.test')).toBe('/');
    expect(safeReturnTo('/\\evil.test')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});

describe('SessionService', () => {
  it('stores only a hash of the token, slides and expires', async () => {
    const t = setup();
    const account = await t.accountService.devAccount('alice');
    const { token, session } = await t.sessions.create(account.id, 'agent');
    expect(session.id).not.toBe(token);
    expect([...t.sessionsRepo.rows.keys()]).toEqual([session.id]);

    expect((await t.sessions.resolve(token))?.account.id).toBe(account.id);
    expect(await t.sessions.resolve('nope')).toBeNull();
    expect(await t.sessions.resolve(null)).toBeNull();

    t.clock.advance(SESSION_TOUCH_MS);
    await t.sessions.resolve(token);
    expect(t.sessionsRepo.rows.get(session.id)?.expiresAt).toBe(t.clock.now() + SESSION_TTL_MS);
    expect(t.accounts.rows.get(account.id)?.lastSeenAt).toBe(t.clock.now());

    t.clock.advance(SESSION_TTL_MS);
    expect(await t.sessions.resolve(token)).toBeNull();
    expect(t.sessionsRepo.rows.size).toBe(0);
  });

  it('logs out one session or every session of the account', async () => {
    const t = setup();
    const account = await t.accountService.devAccount('alice');
    const a = await t.sessions.create(account.id, null);
    const b = await t.sessions.create(account.id, null);
    await t.sessions.logout(a.token);
    expect(await t.sessions.resolve(a.token)).toBeNull();
    expect(await t.sessions.resolve(b.token)).not.toBeNull();
    await t.sessions.create(account.id, null);
    expect(await t.sessions.logoutEverywhere(account.id)).toBe(2);
    expect(await t.sessions.resolve(b.token)).toBeNull();
  });
});

describe('AccountService', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('makes the first account the owner and later ones users', async () => {
    const first = await t.accountService.devAccount('alice');
    const second = await t.accountService.devAccount('bob');
    expect(first.instanceRole).toBe('owner');
    expect(second.instanceRole).toBe('user');
    expect((await t.accountService.devAccount('alice')).id).toBe(first.id);
  });

  it('keeps Discord accounts in sync with the profile', async () => {
    const created = await t.accountService.upsertDiscordAccount(grant('a').profile);
    const renamed = await t.accountService.upsertDiscordAccount({
      ...grant('a').profile,
      globalName: 'Renamed',
      avatarUrl: 'https://cdn.test/a.png',
    });
    expect(renamed).toMatchObject({ id: created.id, name: 'Renamed', avatarUrl: 'https://cdn.test/a.png' });
    expect(t.accounts.rows.size).toBe(1);
  });

  it('lets admins change roles of others but never the owner or themselves', async () => {
    const owner = await t.accountService.devAccount('owner');
    const bob = await t.accountService.devAccount('bob');
    const carol = await t.accountService.devAccount('carol');

    await expect(t.accountService.setRole(actorOf(bob.id), carol.id, 'admin')).rejects.toMatchObject({
      code: 'forbidden',
    });
    const promoted = await t.accountService.setRole(actorOf(owner.id, 'owner'), bob.id, 'admin');
    expect(promoted.instanceRole).toBe('admin');
    expect(t.events.events.map((e) => [e.stream, e.type, e.data])).toEqual([
      ['instance', 'access.role_changed', { accountId: bob.id, role: 'admin' }],
    ]);

    await expect(t.accountService.setRole(actorOf(bob.id, 'admin'), owner.id, 'user')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(t.accountService.setRole(actorOf(bob.id, 'admin'), bob.id, 'user')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(t.accountService.setRole(actorOf(bob.id, 'admin'), 'missing', 'user')).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
    expect((await t.accountService.setRole(actorOf(bob.id, 'admin'), carol.id, 'admin')).instanceRole).toBe(
      'admin',
    );
  });

  it('transfers ownership only from the owner, leaving exactly one owner', async () => {
    const owner = await t.accountService.devAccount('owner');
    const bob = await t.accountService.devAccount('bob');
    await expect(t.accountService.transferOwnership(actorOf(bob.id, 'admin'), bob.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await t.accountService.transferOwnership(actorOf(owner.id, 'owner'), bob.id);
    expect(t.accounts.rows.get(owner.id)?.instanceRole).toBe('admin');
    expect(t.accounts.rows.get(bob.id)?.instanceRole).toBe('owner');
    expect(t.events.events.map((e) => e.data)).toEqual([
      { accountId: owner.id, role: 'admin' },
      { accountId: bob.id, role: 'owner' },
    ]);
  });

  it('raises users to admin through a configured Discord role', async () => {
    await t.accountService.devAccount('owner');
    const bob = await t.accountService.devAccount('bob');
    t.guildPolicy.adminRoles = [{ guildId: 'g1', roleId: 'r-admin' }];
    expect(await t.accountService.effectiveRole(bob)).toBe('user');
    await t.discordLinks.save({
      accountId: bob.id,
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
      guildRoles: [{ guildId: 'g1', roleId: 'r-admin' }],
      rolesCheckedAt: 0,
    });
    expect((await t.accountService.actorFor(bob)).instanceRole).toBe('admin');
    expect((await t.accountService.list(actorOf(bob.id, 'admin'))).map((a) => a.instanceRole)).toEqual([
      'owner',
      'admin',
    ]);
  });

  it('lists the access subjects of an account', async () => {
    const bob = await t.accountService.devAccount('bob');
    const base = { accountId: bob.id, ownerHash: 'h', tokenValid: true, linkedAt: 0, updatedAt: 0 };
    await t.characters.upsert({ ...base, id: 1, name: 'A', corporationId: 10, allianceId: 100 });
    await t.characters.upsert({ ...base, id: 2, name: 'B', corporationId: 10, allianceId: null });
    expect(await t.accountService.subjectsOf(bob.id)).toEqual({
      accountId: bob.id,
      characterIds: [1, 2],
      corporationIds: [10],
      allianceIds: [100],
      discordRoles: [],
    });
  });
});

describe('DiscordLogin', () => {
  it('signs in with state and PKCE and reads guild roles', async () => {
    const t = setup();
    t.guildPolicy.guilds = ['g1'];
    t.discord.grants.set('code-1', grant('token-1'));
    t.discord.roles.set('token-1|g1', ['r1', 'r2']);

    const { url, pending } = await t.discordLogin.start('/m/home');
    expect(url).toContain(pending.state);
    expect(t.discord.lastChallenge).toBe(await pkceChallenge(pending.codeVerifier));

    const signedIn = await t.discordLogin.complete({
      code: 'code-1',
      state: pending.state,
      pending,
      userAgent: null,
    });
    expect(signedIn.returnTo).toBe('/m/home');
    expect(signedIn.account.instanceRole).toBe('owner');
    expect(t.discord.lastVerifier).toBe(pending.codeVerifier);
    expect(t.discordLinks.rows.get(signedIn.account.id)?.guildRoles).toEqual([
      { guildId: 'g1', roleId: 'r1' },
      { guildId: 'g1', roleId: 'r2' },
    ]);
    expect((await t.sessions.resolve(signedIn.token))?.account.id).toBe(signedIn.account.id);
  });

  it('refuses a wrong state, an expired round trip and a rejected code', async () => {
    const t = setup();
    const { pending } = await t.discordLogin.start('/');
    const input = { code: 'code-1', state: pending.state, pending, userAgent: null };
    await expect(t.discordLogin.complete({ ...input, state: 'forged' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(t.discordLogin.complete({ ...input, pending: null })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(t.discordLogin.complete(input)).rejects.toMatchObject({ code: 'unauthenticated' });
    t.clock.advance(11 * 60 * 1000);
    await expect(t.discordLogin.complete(input)).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('GuildRoleSync', () => {
  it('refreshes stale roles with a refreshed token and clears them when access is revoked', async () => {
    const t = setup();
    t.guildPolicy.guilds = ['g1'];
    await t.discordLinks.save({
      accountId: 'acc',
      accessToken: 'old',
      refreshToken: 'r',
      expiresAt: t.clock.now() - 1,
      guildRoles: [{ guildId: 'g1', roleId: 'stale' }],
      rolesCheckedAt: t.clock.now(),
    });
    t.discord.roles.set('refreshed|g1', ['fresh']);

    await t.guildRoles.refreshIfStale('acc');
    expect(t.discord.refreshes).toBe(0);

    t.clock.advance(GUILD_ROLES_TTL_MS);
    await Promise.all([t.guildRoles.refreshIfStale('acc'), t.guildRoles.refreshIfStale('acc')]);
    expect(t.discord.refreshes).toBe(1);
    expect(t.discordLinks.rows.get('acc')).toMatchObject({
      accessToken: 'refreshed',
      refreshToken: 'r+',
      guildRoles: [{ guildId: 'g1', roleId: 'fresh' }],
    });

    t.discord.rejectTokens = true;
    await t.guildRoles.refresh('acc');
    expect(t.discordLinks.rows.get('acc')?.guildRoles).toEqual([]);
  });
});

describe('DevLogin', () => {
  it('signs in a named account with a fake character and refuses stealing one', async () => {
    const t = setup();
    const alice = await t.devLogin.signIn({ name: 'alice', character: { name: 'Alice Pilot' } }, null);
    const [character] = await t.characters.listForAccount(alice.account.id);
    expect(character).toMatchObject({ name: 'Alice Pilot', tokenValid: true, allianceId: null });

    await expect(
      t.devLogin.signIn({ name: 'bob', character: { name: 'Thief', id: character!.id } }, null),
    ).rejects.toMatchObject({ code: 'conflict' });

    const disabled = new DevLogin({
      enabled: false,
      accounts: t.accountService,
      characters: t.characters,
      sessions: t.sessions,
      uow: immediateUow,
      clock: t.clock,
    });
    await expect(disabled.signIn({ name: 'x' }, null)).rejects.toMatchObject({ code: 'not_found' });
  });
});

class FakeEve implements EveSso {
  readonly codes = new Map<string, EveTokenSet>();
  affiliations = new Map<number, { corporationId: number; allianceId: number | null }>();
  rejectRefresh = false;
  refreshes = 0;

  authorizationUrl(input: { state: string; scopes: string[] }) {
    return `https://eve.test/authorize?state=${input.state}&scope=${input.scopes.join('+')}`;
  }
  exchangeCode(input: { code: string }) {
    const tokens = this.codes.get(input.code);
    return tokens ? Promise.resolve(tokens) : Promise.reject(new ExternalAuthError('eve', 'bad code'));
  }
  async refresh(refreshToken: string) {
    this.refreshes++;
    await Promise.resolve();
    if (this.rejectRefresh) throw new ExternalAuthError('eve', 'invalid_grant');
    return eveTokens(1001, 'h1', `access-${this.refreshes}`, `${refreshToken}+`, Date.UTC(2027, 0, 1));
  }
  affiliation(characterId: number) {
    return Promise.resolve(
      this.affiliations.get(characterId) ?? { corporationId: 98000001, allianceId: null },
    );
  }
}

function eveTokens(
  id: number,
  ownerHash: string,
  access = 'access',
  refresh = 'refresh',
  expiresAt = 0,
): EveTokenSet {
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt,
    identity: {
      characterId: id,
      characterName: `Pilot ${id}`,
      ownerHash,
      scopes: ['esi-location.read_location.v1'],
    },
  };
}

describe('CharacterService', () => {
  function withEve() {
    const t = setup();
    const eve = new FakeEve();
    const service = new CharacterService({
      eve,
      characters: t.characters,
      uow: immediateUow,
      clock: t.clock,
      redirectUri: 'https://ww.test/api/auth/eve/callback',
    });
    return { ...t, eve, service };
  }

  async function link(t: ReturnType<typeof withEve>, accountId: string, code: string) {
    const actor = actorOf(accountId);
    const { pending } = await t.service.startLink(actor, '/settings');
    return t.service.completeLink(actor, { code, state: pending.state, pending });
  }

  it('links a character with its affiliation and encrypted-at-rest tokens', async () => {
    const t = withEve();
    t.eve.codes.set('c1', eveTokens(1001, 'h1', 'a1', 'r1', t.clock.now() + 1_200_000));
    t.eve.affiliations.set(1001, { corporationId: 5, allianceId: 6 });

    const { url } = await t.service.startLink(actorOf('acc-a'), '/');
    expect(url).toContain('esi-location.read_location.v1');
    const { character, returnTo } = await link(t, 'acc-a', 'c1');
    expect(returnTo).toBe('/settings');
    expect(character).toMatchObject({ id: 1001, accountId: 'acc-a', corporationId: 5, allianceId: 6 });
    expect(t.characters.tokens.get(1001)).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });
    expect(await t.service.accessToken(1001)).toBe('a1');
    expect(await t.service.character(1001)).toEqual({ name: 'Pilot 1001', accountId: 'acc-a' });
  });

  it('refuses a character held by another account unless it changed EVE owner', async () => {
    const t = withEve();
    t.eve.codes.set('c1', eveTokens(1001, 'h1'));
    t.eve.codes.set('c2', eveTokens(1001, 'h2'));
    await link(t, 'acc-a', 'c1');
    await expect(link(t, 'acc-b', 'c1')).rejects.toMatchObject({ code: 'conflict' });
    expect((await link(t, 'acc-b', 'c2')).character.accountId).toBe('acc-b');
  });

  it('refuses a callback for another account or without sign-in', async () => {
    const t = withEve();
    const { pending } = await t.service.startLink(actorOf('acc-a'), '/');
    await expect(
      t.service.completeLink(actorOf('acc-b'), { code: 'c', state: pending.state, pending }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.service.startLink(null, '/')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refreshes expiring tokens once for concurrent callers and invalidates rejected ones', async () => {
    const t = withEve();
    t.eve.codes.set('c1', eveTokens(1001, 'h1', 'a1', 'r1', t.clock.now() + 30_000));
    await link(t, 'acc-a', 'c1');

    const [x, y] = await Promise.all([t.service.accessToken(1001), t.service.accessToken(1001)]);
    expect([x, y]).toEqual(['access-1', 'access-1']);
    expect(t.eve.refreshes).toBe(1);
    expect(t.characters.tokens.get(1001)?.refreshToken).toBe('r1+');

    t.clock.set(Date.UTC(2027, 0, 1));
    t.eve.rejectRefresh = true;
    expect(await t.service.accessToken(1001)).toBeNull();
    expect((await t.characters.findById(1001))?.tokenValid).toBe(false);
    expect(await t.service.accessToken(1001)).toBeNull();
    expect(t.eve.refreshes).toBe(2);
  });

  it('unlinks only own characters', async () => {
    const t = withEve();
    t.eve.codes.set('c1', eveTokens(1001, 'h1'));
    await link(t, 'acc-a', 'c1');
    await expect(t.service.unlink(actorOf('acc-b'), 1001)).rejects.toMatchObject({ code: 'not_found' });
    await t.service.unlink(actorOf('acc-a'), 1001);
    expect(await t.characters.findById(1001)).toBeNull();
    expect(t.characters.tokens.size).toBe(0);
  });
});
