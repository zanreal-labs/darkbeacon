import { beforeEach, describe, expect, it } from 'vitest';
import {
  ManualClock,
  type Actor,
  type CredentialGrant,
  type DomainEvent,
  type EventLog,
  type NewEvent,
  type UnitOfWork,
} from '@darkbeacon/core';
import type { AccessRule, AccessSubjects } from '../domain/access-rule.js';
import type { InstanceSettings } from '../domain/instance-settings.js';
import type { AccessRuleRepository } from '../ports/access-rule-repository.js';
import type { AccessSubjectsSource, MapOwnership } from '../ports/access-subjects.js';
import type { InstanceSettingsRepository } from '../ports/instance-settings-repository.js';
import { AccessRules } from './access-rules.js';
import { AccessService } from './access-service.js';
import { InstanceSettingsService } from './instance-settings.js';

class MemoryRules implements AccessRuleRepository {
  rows: AccessRule[] = [];
  listForMap(mapId: string) {
    return Promise.resolve(this.rows.filter((r) => r.mapId === mapId));
  }
  findById(id: string) {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }
  insert(rule: AccessRule) {
    this.rows.push(rule);
    return Promise.resolve();
  }
  updateRole(id: string, role: AccessRule['role']) {
    this.rows = this.rows.map((r) => (r.id === id ? { ...r, role } : r));
    return Promise.resolve();
  }
  delete(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
    return Promise.resolve();
  }
  countByMap() {
    const counts = new Map<string, number>();
    for (const r of this.rows) counts.set(r.mapId, (counts.get(r.mapId) ?? 0) + 1);
    return Promise.resolve(counts);
  }
  listMatching(subjects: { kind: AccessRule['subjectKind']; id: string }[]) {
    return Promise.resolve(
      this.rows.filter((r) => subjects.some((s) => s.kind === r.subjectKind && s.id === r.subjectId)),
    );
  }
  discordGuildIds() {
    return Promise.resolve([...new Set(this.rows.flatMap((r) => (r.guildId ? [r.guildId] : [])))]);
  }
}

class Subjects implements AccessSubjectsSource {
  readonly byAccount = new Map<string, Omit<AccessSubjects, 'accountId'>>();
  subjectsOf(accountId: string): Promise<AccessSubjects> {
    const s = this.byAccount.get(accountId);
    return Promise.resolve({
      accountId,
      characterIds: s?.characterIds ?? [],
      corporationIds: s?.corporationIds ?? [],
      allianceIds: s?.allianceIds ?? [],
      discordRoles: s?.discordRoles ?? [],
    });
  }
}

class Owners implements MapOwnership {
  readonly owners = new Map<string, string>();
  ownerOf(mapId: string) {
    return Promise.resolve(this.owners.get(mapId) ?? null);
  }
  mapsOwnedBy(accountId: string) {
    return Promise.resolve([...this.owners].filter(([, o]) => o === accountId).map(([m]) => m));
  }
  allMaps() {
    return Promise.resolve([...this.owners.keys()]);
  }
}

const grant = (over: Partial<CredentialGrant> = {}): CredentialGrant => ({
  credentialId: 'k',
  name: 'Key',
  kind: 'pat',
  channel: 'api',
  scopes: [],
  readOnly: false,
  allMaps: null,
  maps: {},
  ...over,
});

class Events implements EventLog {
  readonly events: DomainEvent[] = [];
  append(events: readonly NewEvent[]) {
    const stored = events.map((e) => ({ ...e, seq: this.events.length + 1, v: 1 as const }));
    this.events.push(...stored);
    return Promise.resolve(stored);
  }
  readSince = () => Promise.resolve([]);
  headSeq = () => Promise.resolve(0);
  oldestSeq = () => Promise.resolve(null);
  prune = () => Promise.resolve(0);
}

const uow: UnitOfWork = { transaction: (work) => work() };
const account = (id: string): Actor => ({ kind: 'account', id, instanceRole: 'user' });

describe('access', () => {
  let rules: MemoryRules;
  let subjects: Subjects;
  let owners: Owners;
  let events: Events;
  let service: AccessService;
  let accessRules: AccessRules;

  beforeEach(() => {
    rules = new MemoryRules();
    subjects = new Subjects();
    owners = new Owners();
    events = new Events();
    service = new AccessService({ rules, subjects, ownership: owners });
    accessRules = new AccessRules({ rules, access: service, uow, events, clock: new ManualClock() });
    owners.owners.set('m1', 'owner');
    owners.owners.set('m2', 'other');
    subjects.byAccount.set('pilot', {
      characterIds: [1],
      corporationIds: [10],
      allianceIds: [100],
      discordRoles: [{ guildId: '111', roleId: '222' }],
    });
  });

  describe('AccessService', () => {
    it('makes the owner admin and gives others nothing without a rule', async () => {
      expect(await service.roleOf(account('owner'), 'm1')).toBe('admin');
      expect(await service.roleOf(account('pilot'), 'm1')).toBeNull();
      expect(await service.roleOf(account('owner'), 'missing')).toBeNull();
      // Instance admins get no implicit map access.
      expect(await service.roleOf({ kind: 'account', id: 'boss', instanceRole: 'owner' }, 'm1')).toBeNull();
    });

    it('resolves roles from rules and reports maps the actor can see', async () => {
      const owner = account('owner');
      await accessRules.add(owner, 'm1', { subjectKind: 'corporation', subjectId: '10', role: 'member' });
      await accessRules.add(account('other'), 'm2', {
        subjectKind: 'discordRole',
        subjectId: '222',
        guildId: '111',
        role: 'viewer',
      });
      expect(await service.roleOf(account('pilot'), 'm1')).toBe('member');
      expect(await service.mapsFor(account('pilot'))).toEqual([
        { mapId: 'm1', role: 'member' },
        { mapId: 'm2', role: 'viewer' },
      ]);
      expect(await service.mapsFor(owner)).toEqual([{ mapId: 'm1', role: 'admin' }]);

      await accessRules.add(owner, 'm1', { subjectKind: 'character', subjectId: '1', role: 'blocked' });
      expect(await service.roleOf(account('pilot'), 'm1')).toBe('blocked');
      expect(await service.mapsFor(account('pilot'))).toEqual([{ mapId: 'm2', role: 'viewer' }]);

      // Rules of a deleted map are ignored.
      owners.owners.delete('m2');
      expect(await service.mapsFor(account('pilot'))).toEqual([]);
    });

    it('gives service keys their own roles, capped by their scopes, and treats system actors as admin', async () => {
      const token: Actor = {
        kind: 'apiToken',
        id: 't',
        instanceRole: 'user',
        roles: { allMaps: null, maps: { m1: 'manager' } },
        grant: grant({ kind: 'svc', allMaps: 'viewer' }),
      };
      expect(await service.roleOf(token, 'm1')).toBe('viewer');
      expect(await service.roleOf(token, 'm2')).toBeNull();
      expect(await service.mapsFor(token)).toEqual([{ mapId: 'm1', role: 'viewer' }]);
      const everywhere: Actor = {
        ...token,
        roles: { allMaps: 'member', maps: {} },
        grant: grant({ kind: 'svc', allMaps: 'admin' }),
      } as Actor;
      expect(await service.mapsFor(everywhere)).toEqual([
        { mapId: 'm1', role: 'member' },
        { mapId: 'm2', role: 'member' },
      ]);
      expect(await service.roleOf({ kind: 'system', id: 'tracking' }, 'm2')).toBe('admin');
      expect(await service.mapsFor({ kind: 'plugin', id: 'p' })).toEqual([]);
    });

    it('lets a personal token only narrow its owner', async () => {
      const owner = account('owner');
      const via = (g: Partial<CredentialGrant>): Actor => ({ ...owner, grant: grant(g) }) as Actor;
      // The owner is admin on m1 (its own map) and has nothing on m2.
      expect(await service.roleOf(via({ allMaps: 'viewer' }), 'm1')).toBe('viewer');
      expect(await service.roleOf(via({ maps: { m1: 'member' } }), 'm1')).toBe('member');
      expect(await service.roleOf(via({ maps: { m1: 'member' } }), 'm2')).toBeNull();
      expect(await service.mapsFor(via({ maps: { m1: 'member' } }))).toEqual([
        { mapId: 'm1', role: 'member' },
      ]);
      // A cap above the owner's own role changes nothing: the pilot is only a viewer.
      await accessRules.add(owner, 'm1', { subjectKind: 'account', subjectId: 'pilot', role: 'viewer' });
      const pilot: Actor = { ...account('pilot'), grant: grant({ allMaps: 'admin' }) } as Actor;
      expect(await service.roleOf(pilot, 'm1')).toBe('viewer');
      expect(await service.roleOf(pilot, 'm2')).toBeNull();
    });

    it('lets a public visitor view only the map it came through', async () => {
      const visitor: Actor = { kind: 'public', id: 'share', mapId: 'm1' };
      expect(await service.roleOf(visitor, 'm1')).toBe('viewer');
      expect(await service.roleOf(visitor, 'm2')).toBeNull();
      expect(await service.mapsFor(visitor)).toEqual([{ mapId: 'm1', role: 'viewer' }]);
      await expect(service.require(visitor, 'm1', 'member')).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('hides maps the actor cannot view and forbids what it may not do', async () => {
      await expect(service.require(account('pilot'), 'm1', 'viewer')).rejects.toMatchObject({
        code: 'not_found',
      });
      await accessRules.add(account('owner'), 'm1', {
        subjectKind: 'account',
        subjectId: 'pilot',
        role: 'viewer',
      });
      expect(await service.require(account('pilot'), 'm1', 'viewer')).toBe('viewer');
      await expect(service.require(account('pilot'), 'm1', 'member')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(service.require(null, 'm1', 'viewer')).rejects.toMatchObject({ code: 'unauthenticated' });
    });
  });

  describe('AccessRules', () => {
    it('lets map admins manage rules and emits events on the map stream', async () => {
      const owner = account('owner');
      const added = await accessRules.add(owner, 'm1', {
        subjectKind: 'alliance',
        subjectId: '100',
        role: 'viewer',
      });
      expect(added).toMatchObject({ mapId: 'm1', subjectKind: 'alliance', subjectId: '100', guildId: null });
      expect(await accessRules.list(owner, 'm1')).toEqual([added]);

      await expect(
        accessRules.add(owner, 'm1', { subjectKind: 'alliance', subjectId: '100', role: 'admin' }),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        accessRules.add(owner, 'm1', { subjectKind: 'alliance', subjectId: 'x', role: 'admin' }),
      ).rejects.toMatchObject({ code: 'validation' });

      await expect(accessRules.remove(owner, 'm2', added.id)).rejects.toMatchObject({ code: 'not_found' });
      await accessRules.remove(owner, 'm1', added.id);
      expect(events.events.map((e) => [e.stream, e.type, e.data])).toEqual([
        ['map:m1', 'access.rule_added', added],
        ['map:m1', 'access.rule_removed', { id: added.id }],
      ]);
    });

    it('lets managers handle viewers, members and blocks only, as in Wanderer', async () => {
      const owner = account('owner');
      const pilot = account('pilot');
      await accessRules.add(owner, 'm1', { subjectKind: 'character', subjectId: '1', role: 'manager' });
      const boss = await accessRules.add(owner, 'm1', {
        subjectKind: 'corporation',
        subjectId: '50',
        role: 'admin',
      });
      expect(await accessRules.list(pilot, 'm1')).toHaveLength(2);

      // Members, viewers and blocks: add, change between them, remove.
      const spy = await accessRules.add(pilot, 'm1', {
        subjectKind: 'corporation',
        subjectId: '666',
        role: 'viewer',
      });
      expect(await accessRules.update(pilot, 'm1', spy.id, 'blocked')).toMatchObject({ role: 'blocked' });
      // Never managers or admins, and never a rule that is one.
      await expect(accessRules.update(pilot, 'm1', spy.id, 'manager')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        accessRules.add(pilot, 'm1', { subjectKind: 'character', subjectId: '2', role: 'admin' }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(accessRules.update(pilot, 'm1', boss.id, 'viewer')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(accessRules.remove(pilot, 'm1', boss.id)).rejects.toMatchObject({ code: 'forbidden' });
      await accessRules.remove(pilot, 'm1', spy.id);

      // Members and strangers manage nothing.
      subjects.byAccount.set('grunt', {
        characterIds: [7],
        corporationIds: [],
        allianceIds: [],
        discordRoles: [],
      });
      await accessRules.add(owner, 'm1', { subjectKind: 'character', subjectId: '7', role: 'member' });
      await expect(accessRules.list(account('grunt'), 'm1')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(accessRules.list(account('stranger'), 'm1')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('changes a role in place and records the role before', async () => {
      const owner = account('owner');
      const rule = await accessRules.add(owner, 'm1', {
        subjectKind: 'alliance',
        subjectId: '100',
        role: 'viewer',
      });
      const changed = await accessRules.update(owner, 'm1', rule.id, 'member');
      expect(changed).toMatchObject({ id: rule.id, subjectId: '100', role: 'member' });
      expect(await service.roleOf(account('pilot'), 'm1')).toBe('member');
      // The same role again changes nothing and records nothing.
      await accessRules.update(owner, 'm1', rule.id, 'member');
      const last = events.events.at(-1)!;
      expect(last).toMatchObject({ type: 'access.rule_changed', data: changed, before: rule });
      expect(events.events.filter((e) => e.type === 'access.rule_changed')).toHaveLength(1);
      await expect(accessRules.update(owner, 'm2', rule.id, 'admin')).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('copies rules from another map the caller manages', async () => {
      const owner = account('owner');
      owners.owners.set('m3', 'owner');
      await accessRules.add(owner, 'm3', { subjectKind: 'alliance', subjectId: '100', role: 'member' });
      await accessRules.add(owner, 'm3', { subjectKind: 'corporation', subjectId: '666', role: 'blocked' });
      await accessRules.add(owner, 'm1', { subjectKind: 'alliance', subjectId: '100', role: 'viewer' });

      expect(await accessRules.copyFrom(owner, 'm1', 'm3')).toEqual({ added: 1, updated: 0, skipped: 1 });
      expect(await accessRules.copyFrom(owner, 'm1', 'm3', true)).toEqual({
        added: 0,
        updated: 1,
        skipped: 1,
      });
      const roles = (await accessRules.list(owner, 'm1')).map((r) => [r.subjectId, r.role]);
      expect(roles).toEqual([
        ['100', 'member'],
        ['666', 'blocked'],
      ]);
      // A map the caller cannot read the rules of is not a source.
      await expect(accessRules.copyFrom(owner, 'm1', 'm2')).rejects.toMatchObject({ code: 'not_found' });
      await expect(accessRules.copyFrom(owner, 'm1', 'm1')).rejects.toMatchObject({ code: 'validation' });
    });

    it('makes a starter rule only for the creator’s own corporation or alliance', async () => {
      const rulesWithSubjects = new AccessRules({
        rules,
        access: service,
        uow,
        events,
        clock: new ManualClock(),
        subjects,
      });
      owners.owners.set('m4', 'pilot');
      await expect(
        rulesWithSubjects.addStarter(account('pilot'), 'm4', {
          subjectKind: 'corporation',
          subjectId: '999',
          role: 'member',
        }),
      ).rejects.toMatchObject({ code: 'validation' });
      expect(
        await rulesWithSubjects.addStarter(account('pilot'), 'm4', {
          subjectKind: 'alliance',
          subjectId: '100',
          role: 'member',
        }),
      ).toMatchObject({ subjectKind: 'alliance', subjectId: '100', role: 'member' });
    });
  });
});

describe('InstanceSettingsService', () => {
  class MemorySettings implements InstanceSettingsRepository {
    stored: Partial<InstanceSettings> = {};
    load() {
      return Promise.resolve({ ...this.stored });
    }
    save(settings: Partial<InstanceSettings>) {
      this.stored = { ...this.stored, ...settings };
      return Promise.resolve();
    }
  }

  it('is admin-only, merges updates and reports the guilds that matter', async () => {
    const rules = new MemoryRules();
    const log = new Events();
    const service = new InstanceSettingsService({
      settings: new MemorySettings(),
      rules,
      uow,
      events: log,
      clock: new ManualClock(),
    });
    const admin: Actor = { kind: 'account', id: 'a', instanceRole: 'admin' };

    await expect(service.get(account('u'))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await service.get(admin)).toEqual({
      adminGuildId: null,
      adminRoleIds: [],
      webhooksToPrivateNetworks: false,
      eventRetentionDays: null,
      loginMethod: null,
      defaultMapId: null,
      expiredConnectionMinutes: 0,
      autoEol: true,
      staleSystemMinutes: 15,
      mcpMode: 'off',
      apiCorsOrigins: [],
      publicMaps: true,
      mapCreation: 'everyone',
      apiAccess: true,
      webhooksEnabled: true,
      signIn: { mode: 'open', corporationIds: [], allianceIds: [], guildIds: [] },
    });
    expect(await service.update(admin, { adminGuildId: 'g1', adminRoleIds: ['r1', 'r1'] })).toEqual({
      adminGuildId: 'g1',
      adminRoleIds: ['r1'],
      webhooksToPrivateNetworks: false,
      eventRetentionDays: null,
      loginMethod: null,
      defaultMapId: null,
      expiredConnectionMinutes: 0,
      autoEol: true,
      staleSystemMinutes: 15,
      mcpMode: 'off',
      apiCorsOrigins: [],
      publicMaps: true,
      mapCreation: 'everyone',
      apiAccess: true,
      webhooksEnabled: true,
      signIn: { mode: 'open', corporationIds: [], allianceIds: [], guildIds: [] },
    });
    expect((await service.update(admin, {})).adminGuildId).toBe('g1');
    // A change is recorded on the audit stream with what it was before; no change, no record.
    expect(log.events.map((e) => [e.stream, e.type])).toEqual([['audit:instance', 'settings.changed']]);
    expect(
      (log.events[0] as unknown as { before: { adminGuildId: string | null } }).before.adminGuildId,
    ).toBeNull();

    await rules.insert({
      id: 'x',
      mapId: 'm',
      subjectKind: 'discordRole',
      subjectId: 'r9',
      guildId: 'g2',
      role: 'viewer',
      createdAt: 0,
      createdBy: 'a',
    });
    expect(await service.guildIds()).toEqual(['g1', 'g2']);
    expect(await service.grantsAdmin([{ guildId: 'g1', roleId: 'r1' }])).toBe(true);
    expect(await service.grantsAdmin([{ guildId: 'g2', roleId: 'r1' }])).toBe(false);

    // With EVE sign-in, Discord roles no longer make anyone an admin.
    await service.update(admin, { loginMethod: 'eve' });
    expect(await service.loginMethod()).toBe('eve');
    expect(await service.grantsAdmin([{ guildId: 'g1', roleId: 'r1' }])).toBe(false);
  });

  it('signs people in with EVE when Discord is not configured, else as chosen', async () => {
    const rules = new MemoryRules();
    const admin: Actor = { kind: 'account', id: 'a', instanceRole: 'admin' };
    const withDiscord = new InstanceSettingsService({
      settings: new MemorySettings(),
      rules,
      uow,
      events: new Events(),
      clock: new ManualClock(),
    });
    expect(await withDiscord.loginMethod()).toBe('discord');
    await withDiscord.update(admin, { loginMethod: 'eve', defaultMapId: 'map-1' });
    expect(await withDiscord.loginMethod()).toBe('eve');
    expect((await withDiscord.current()).defaultMapId).toBe('map-1');

    const noDiscord = new InstanceSettingsService({
      settings: new MemorySettings(),
      rules,
      uow,
      events: new Events(),
      clock: new ManualClock(),
      discordConfigured: false,
    });
    expect(await noDiscord.loginMethod()).toBe('eve');
    await expect(noDiscord.update(admin, { loginMethod: 'discord' })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});
