import { expect, it } from 'vitest';
import { describeEachDialect } from '@wormwright/db/testing';
import type { Account, LinkedCharacter } from '@wormwright/identity';
import {
  KyselyAccountRepository,
  KyselyCharacterRepository,
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
    expect(await repo.findById('a')).toEqual(
      account('a', { discordId: '123', name: 'Alice', instanceRole: 'owner' }),
    );
    expect((await repo.findByDiscordId('123'))?.id).toBe('a');
    expect((await repo.findByName('dev-bob'))?.id).toBe('b');
    // Discord accounts are never matched by name.
    expect(await repo.findByName('Alice')).toBeNull();

    await repo.update({ ...account('b', { name: 'dev-bob' }), instanceRole: 'admin', updatedAt: 5 });
    await repo.touch('b', 1_900_000_000_000);
    expect(await repo.findById('b')).toMatchObject({
      instanceRole: 'admin',
      updatedAt: 5,
      lastSeenAt: 1_900_000_000_000,
    });
    expect((await repo.list()).map((a) => a.id)).toEqual(['a', 'b']);
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

    const tokens = {
      accessToken: 'plain-access',
      refreshToken: 'plain-refresh',
      expiresAt: 1_800_000_000_000,
      scopes: ['x'],
    };
    await repo.saveTokens(pilot.id, tokens);
    await repo.saveTokens(pilot.id, { ...tokens, accessToken: 'newer' });
    expect(await repo.getTokens(pilot.id)).toEqual({ ...tokens, accessToken: 'newer' });
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
  });
});
