import { expect, it } from 'vitest';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { Account, LinkedCharacter } from '@darkbeacon/identity';
import {
  KyselyAccountRepository,
  KyselyCharacterRepository,
  KyselyDiscordBotStore,
  KyselyDiscordLinkRepository,
  KyselySessionRepository,
  type IdentityTables,
} from './kysely-identity.js';
import { SecretBox } from './secret-box.js';

const account = (id: string, overrides: Partial<Account> = {}): Account => ({
  id,
  discordId: null,
  name: id,
  avatarUrl: null,
  instanceRole: 'user',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  lastSeenAt: null,
  ...overrides,
});

const character = (id: number, accountId: string): LinkedCharacter => ({
  id,
  accountId,
  name: `Pilot ${id}`,
  corporationId: 98_000_001,
  allianceId: 99_000_001,
  ownerHash: 'hash',
  tokenValid: true,
  linkedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
});

const box = new SecretBox('k'.repeat(32), 'test');

describeEachDialect('identity repositories', (t) => {
  it('stores and finds accounts', async () => {
    const repo = new KyselyAccountRepository(t.db);
    await repo.insert(account('a', { discordId: '123', name: 'Alice', instanceRole: 'owner' }));
    await repo.insert(account('b', { name: 'dev-bob', createdAt: 1_800_000_000_000 }));
    expect(await repo.count()).toBe(2);
    expect(await repo.findById('a')).toEqual({
      ...account('a', { discordId: '123', name: 'Alice', instanceRole: 'owner' }),
      mainCharacterId: null,
      defaultMapId: null,
      recentMapIds: [],
      disabledAt: null,
      disabledReason: null,
    });
    expect((await repo.findByDiscordId('123'))?.id).toBe('a');
    expect((await repo.findByName('dev-bob'))?.id).toBe('b');
    // Discord accounts are never matched by name.
    expect(await repo.findByName('Alice')).toBeNull();

    await repo.update({
      ...account('b', { name: 'dev-bob' }),
      instanceRole: 'admin',
      defaultMapId: 'map-1',
      updatedAt: 5,
    });
    await repo.touch('b', 1_900_000_000_000);
    await repo.setRecentMaps('b', ['map-2', 'map-1']);
    expect(await repo.findById('b')).toMatchObject({
      instanceRole: 'admin',
      defaultMapId: 'map-1',
      recentMapIds: ['map-2', 'map-1'],
      updatedAt: 5,
      lastSeenAt: 1_900_000_000_000,
    });
    expect((await repo.list()).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('finds accounts by part of their name, prefixes first', async () => {
    const repo = new KyselyAccountRepository(t.db);
    await repo.insert(account('a', { name: 'Ayla Vex', discordId: '1' }));
    await repo.insert(account('b', { name: 'Vexed 100%' }));
    await repo.insert(account('c', { name: 'Torren' }));
    expect((await repo.search('vex', 10)).map((a) => a.name)).toEqual(['Vexed 100%', 'Ayla Vex']);
    expect((await repo.search('0%', 10)).map((a) => a.id)).toEqual(['b']);
    // `%` and `_` are literal characters, not wildcards.
    expect(await repo.search('%', 10)).toHaveLength(1);
    expect(await repo.search('_', 10)).toHaveLength(0);
  });

  it('lists sessions of an account, most recently used first', async () => {
    const repo = new KyselySessionRepository(t.db);
    await repo.insert({
      id: 's1',
      accountId: 'a',
      createdAt: 1,
      lastSeenAt: 5,
      expiresAt: 9e12,
      userAgent: null,
    });
    await repo.insert({
      id: 's2',
      accountId: 'a',
      createdAt: 1,
      lastSeenAt: 7,
      expiresAt: 9e12,
      userAgent: 'ua',
    });
    await repo.insert({
      id: 's3',
      accountId: 'b',
      createdAt: 1,
      lastSeenAt: 9,
      expiresAt: 9e12,
      userAgent: null,
    });
    expect((await repo.listForAccount('a')).map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('allows only one owner and one account per Discord user', async () => {
    const repo = new KyselyAccountRepository(t.db);
    await repo.insert(account('a', { instanceRole: 'owner', discordId: '1' }));
    await expect(repo.insert(account('b', { instanceRole: 'owner' }))).rejects.toThrow();
    await expect(repo.insert(account('c', { discordId: '1' }))).rejects.toThrow();
    // Accounts without a Discord id (dev login) do not collide.
    await repo.insert(account('d'));
    await repo.insert(account('e'));
    expect(await repo.count()).toBe(3);
  });

  it('stores sessions, slides and deletes them', async () => {
    const repo = new KyselySessionRepository(t.db);
    const base = { accountId: 'a', createdAt: 1, lastSeenAt: 1, userAgent: 'ua' };
    await repo.insert({ ...base, id: 's1', expiresAt: 1_800_000_000_000 });
    await repo.insert({ ...base, id: 's2', expiresAt: 100 });
    await repo.insert({ ...base, id: 's3', accountId: 'b', expiresAt: 1_800_000_000_000 });
    await repo.touch('s1', 50, 1_900_000_000_000);
    expect(await repo.findById('s1')).toEqual({
      ...base,
      id: 's1',
      lastSeenAt: 50,
      expiresAt: 1_900_000_000_000,
    });
    expect(await repo.deleteExpired(1000)).toBe(1);
    expect(await repo.deleteForAccount('a')).toBe(1);
    await repo.delete('s3');
    expect(await repo.findById('s3')).toBeNull();
  });

  it('stores characters with encrypted tokens', async () => {
    const repo = new KyselyCharacterRepository(t.db, box);
    const pilot = character(2_112_000_001, 'a');
    await repo.upsert(pilot);
    await repo.upsert({ ...pilot, allianceId: null, tokenValid: false });
    await repo.upsert(character(2_112_000_002, 'a'));
    expect(await repo.findById(pilot.id)).toEqual({ ...pilot, allianceId: null, tokenValid: false });
    expect((await repo.listForAccount('a')).map((c) => c.id)).toEqual([2_112_000_001, 2_112_000_002]);

    // Token use only updates a character that still belongs to the account it was read for.
    expect(await repo.updateState(pilot.id, 'b', { tokenValid: true, updatedAt: 9 })).toBe(false);
    expect(await repo.updateState(pilot.id, 'a', { corporationId: 7, allianceId: 8, updatedAt: 9 })).toBe(
      true,
    );
    expect(await repo.findById(pilot.id)).toMatchObject({ accountId: 'a', corporationId: 7, allianceId: 8 });
    await repo.upsert({ ...pilot, allianceId: null, tokenValid: false });

    const tokens = {
      accessToken: 'plain-access',
      refreshToken: 'plain-refresh',
      expiresAt: 1_800_000_000_000,
      scopes: ['x'],
    };
    await repo.saveTokens(pilot.id, tokens);
    await repo.saveTokens(pilot.id, { ...tokens, accessToken: 'newer' });
    expect(await repo.getTokens(pilot.id)).toEqual({ ...tokens, accessToken: 'newer' });
    expect(await repo.scopesOf([pilot.id, 404])).toEqual(new Map([[pilot.id, ['x']]]));
    expect(await repo.scopesOf([])).toEqual(new Map());
    const raw = await t.db
      .db<IdentityTables>()
      .selectFrom('eve_character_token')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(raw)).not.toContain('newer');
    expect(JSON.stringify(raw)).not.toContain('plain-refresh');

    await repo.delete(pilot.id);
    expect(await repo.findById(pilot.id)).toBeNull();
    expect(await repo.getTokens(pilot.id)).toBeNull();
  });

  it('stores Discord links with encrypted tokens', async () => {
    const repo = new KyselyDiscordLinkRepository(t.db, box);
    const link = {
      accountId: 'a',
      accessToken: 'discord-access',
      refreshToken: 'discord-refresh',
      expiresAt: 1_800_000_000_000,
      guildRoles: [{ guildId: '1', roleId: '2' }],
      rolesCheckedAt: null,
    };
    await repo.save(link);
    expect(await repo.find('a')).toEqual(link);
    await repo.save({ ...link, guildRoles: [], rolesCheckedAt: 7 });
    expect(await repo.find('a')).toEqual({ ...link, guildRoles: [], rolesCheckedAt: 7 });
    const raw = await t.db
      .db<IdentityTables>()
      .selectFrom('discord_link')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(raw)).not.toContain('discord-access');
    expect(await repo.find('missing')).toBeNull();
    await repo.remove('a');
    expect(await repo.find('a')).toBeNull();
  });

  it('keeps one Discord bot with its token sealed', async () => {
    const store = new KyselyDiscordBotStore(t.db, box);
    expect(await store.load()).toBeNull();
    const bot = {
      token: 'bot-token-secret',
      user: { id: '9', name: 'Beacon', avatarUrl: null },
      error: null,
    };
    await store.save(bot);
    await store.save({ ...bot, error: 'Missing access' });
    expect(await store.load()).toEqual({ ...bot, error: 'Missing access' });
    const raw = await t.db.db<IdentityTables>().selectFrom('discord_bot').selectAll().execute();
    expect(raw).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain('bot-token-secret');
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
