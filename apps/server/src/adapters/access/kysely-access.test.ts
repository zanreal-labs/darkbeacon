import { expect, it } from 'vitest';
import type { AccessRule } from '@wormwright/access';
import { describeEachDialect } from '@wormwright/db/testing';
import { KyselyAccessRuleRepository, KyselyInstanceSettingsRepository } from './kysely-access.js';

let n = 0;
const rule = (overrides: Partial<AccessRule>): AccessRule => ({
  id: `rule-${String(++n).padStart(4, '0')}`,
  mapId: 'm1',
  subjectKind: 'character',
  subjectId: '1',
  guildId: null,
  role: 'viewer',
  createdAt: 1_700_000_000_000 + n,
  createdBy: 'acc',
  ...overrides,
});

describeEachDialect('access repositories', (t) => {
  it('stores rules per map and refuses a duplicate subject', async () => {
    const repo = new KyselyAccessRuleRepository(t.db);
    const a = rule({});
    const b = rule({ subjectKind: 'discordRole', subjectId: '555', guildId: '777', role: 'member' });
    const c = rule({ mapId: 'm2', subjectKind: 'corporation', subjectId: '10' });
    for (const r of [a, b, c]) await repo.insert(r);
    expect(await repo.listForMap('m1')).toEqual([a, b]);
    expect(await repo.findById(c.id)).toEqual(c);
    await expect(repo.insert(rule({ subjectId: '1', role: 'admin' }))).rejects.toThrow();
    await repo.delete(a.id);
    expect(await repo.findById(a.id)).toBeNull();
  });

  it('finds rules matching any of the subjects across maps', async () => {
    const repo = new KyselyAccessRuleRepository(t.db);
    const hits = [
      rule({ subjectKind: 'character', subjectId: '1' }),
      rule({ mapId: 'm2', subjectKind: 'alliance', subjectId: '100' }),
      rule({ mapId: 'm3', subjectKind: 'discordRole', subjectId: '9', guildId: '8' }),
    ];
    const misses = [
      rule({ subjectKind: 'corporation', subjectId: '1' }),
      rule({ subjectKind: 'character', subjectId: '2' }),
    ];
    for (const r of [...hits, ...misses]) await repo.insert(r);
    const found = await repo.listMatching([
      { kind: 'character', id: '1' },
      { kind: 'alliance', id: '100' },
      { kind: 'discordRole', id: '9' },
    ]);
    expect(found.map((r) => r.id).sort()).toEqual(hits.map((r) => r.id).sort());
    expect(await repo.listMatching([])).toEqual([]);
    expect(await repo.discordGuildIds()).toEqual(['8']);
  });

  it('stores instance settings as JSON values', async () => {
    const repo = new KyselyInstanceSettingsRepository(t.db);
    expect(await repo.load()).toEqual({});
    await repo.save({ adminGuildId: '1', adminRoleIds: ['2', '3'] });
    await repo.save({ adminGuildId: null, defaultTheme: 'dark' });
    expect(await repo.load()).toEqual({ adminGuildId: null, adminRoleIds: ['2', '3'], defaultTheme: 'dark' });
  });
});
