import { describe, expect, it } from 'vitest';
import { resolveMapRole } from '@wormwright/core';
import { grantsFor, parseSubject, subjectKeys, type AccessRule, type AccessSubjects } from './access-rule.js';
import { adminByDiscord, DEFAULT_INSTANCE_SETTINGS } from './instance-settings.js';

const subjects: AccessSubjects = {
  accountId: 'acc',
  characterIds: [1],
  corporationIds: [10],
  allianceIds: [100],
  discordRoles: [{ guildId: 'g1', roleId: 'r1' }],
};

let n = 0;
const rule = (
  subjectKind: AccessRule['subjectKind'],
  subjectId: string,
  role: AccessRule['role'],
  guildId: string | null = null,
): AccessRule => ({
  id: `rule-${++n}`,
  mapId: 'map',
  subjectKind,
  subjectId,
  guildId,
  role,
  createdAt: 0,
  createdBy: 'x',
});

const roleFor = (...rules: AccessRule[]) => resolveMapRole(grantsFor(rules, subjects));

describe('access rules', () => {
  it('matches every kind of subject, Discord roles only on their guild', () => {
    expect(roleFor(rule('account', 'acc', 'viewer'))).toBe('viewer');
    expect(roleFor(rule('character', '1', 'member'))).toBe('member');
    expect(roleFor(rule('corporation', '10', 'manager'))).toBe('manager');
    expect(roleFor(rule('alliance', '100', 'admin'))).toBe('admin');
    expect(roleFor(rule('discordRole', 'r1', 'viewer', 'g1'))).toBe('viewer');
    expect(roleFor(rule('discordRole', 'r1', 'viewer', 'g2'))).toBeNull();
    expect(roleFor(rule('character', '2', 'admin'), rule('corporation', '11', 'admin'))).toBeNull();
  });

  it('lets the highest role win', () => {
    expect(roleFor(rule('alliance', '100', 'viewer'), rule('corporation', '10', 'manager'))).toBe('manager');
  });

  it('lets a block on a character or the account beat everything', () => {
    expect(roleFor(rule('alliance', '100', 'admin'), rule('character', '1', 'blocked'))).toBe('blocked');
    expect(roleFor(rule('corporation', '10', 'admin'), rule('account', 'acc', 'blocked'))).toBe('blocked');
  });

  it('treats a block on a group as losing against any grant', () => {
    expect(roleFor(rule('alliance', '100', 'blocked'), rule('character', '1', 'viewer'))).toBe('viewer');
    expect(roleFor(rule('corporation', '10', 'blocked'))).toBe('blocked');
  });

  it('lists the subject keys of an account', () => {
    expect(subjectKeys(subjects)).toEqual([
      { kind: 'account', id: 'acc' },
      { kind: 'character', id: '1' },
      { kind: 'corporation', id: '10' },
      { kind: 'alliance', id: '100' },
      { kind: 'discordRole', id: 'r1' },
    ]);
  });

  it('validates subjects', () => {
    expect(parseSubject({ subjectKind: 'character', subjectId: ' 90000001 ' })).toEqual({
      ok: true,
      value: { subjectId: '90000001', guildId: null },
    });
    expect(parseSubject({ subjectKind: 'corporation', subjectId: 'abc' }).ok).toBe(false);
    expect(parseSubject({ subjectKind: 'alliance', subjectId: '0' }).ok).toBe(false);
    expect(parseSubject({ subjectKind: 'discordRole', subjectId: '123', guildId: '456' })).toEqual({
      ok: true,
      value: { subjectId: '123', guildId: '456' },
    });
    expect(parseSubject({ subjectKind: 'discordRole', subjectId: '123' }).ok).toBe(false);
    expect(parseSubject({ subjectKind: 'account', subjectId: 'acc' }).ok).toBe(true);
  });
});

describe('instance settings', () => {
  it('grants admin only for a configured role on the admin guild', () => {
    const settings = { ...DEFAULT_INSTANCE_SETTINGS, adminGuildId: 'g1', adminRoleIds: ['r1'] };
    expect(adminByDiscord(settings, [{ guildId: 'g1', roleId: 'r1' }])).toBe(true);
    expect(adminByDiscord(settings, [{ guildId: 'g2', roleId: 'r1' }])).toBe(false);
    expect(adminByDiscord(DEFAULT_INSTANCE_SETTINGS, [{ guildId: 'g1', roleId: 'r1' }])).toBe(false);
  });
});
