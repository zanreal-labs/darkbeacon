import { describe, expect, it } from 'vitest';
import { ManualClock, newEvent, type DomainEvent } from '@darkbeacon/core';
import type { AccessRule, AccessRuleRepository, AccessSubjects } from '@darkbeacon/access';
import { AccessCache } from './cached-access.js';

const rule = (mapId: string, id = 'r1'): AccessRule => ({
  id,
  mapId,
  subjectKind: 'alliance',
  subjectId: '99000001',
  guildId: null,
  role: 'member',
  createdAt: 0,
  createdBy: 'owner',
});

function setup() {
  const clock = new ManualClock(0);
  let transaction = false;
  const cache = new AccessCache({ clock, inTransaction: () => transaction, ttlMs: 10_000 });
  const reads = { rules: 0, subjects: 0, owners: 0 };
  const stored = new Map<string, AccessRule[]>([['m1', [rule('m1')]]]);
  const inner: AccessRuleRepository = {
    listForMap: async (mapId) => (reads.rules++, stored.get(mapId) ?? []),
    findById: async (id) => [...stored.values()].flat().find((r) => r.id === id) ?? null,
    insert: async (r) => void stored.set(r.mapId, [...(stored.get(r.mapId) ?? []), r]),
    delete: async (id) => {
      for (const [mapId, rules] of stored)
        stored.set(
          mapId,
          rules.filter((r) => r.id !== id),
        );
    },
    listMatching: async () => [],
    discordGuildIds: async () => [],
  };
  const subjects: AccessSubjects = {
    accountId: 'a1',
    characterIds: [1],
    corporationIds: [2],
    allianceIds: [3],
    discordRoles: [],
  };
  return {
    clock,
    cache,
    reads,
    rules: cache.ruleRepository(inner),
    subjects: cache.subjectsSource({ subjectsOf: async () => (reads.subjects++, subjects) }),
    owners: cache.ownership({
      ownerOf: async () => (reads.owners++, 'owner'),
      mapsOwnedBy: async () => [],
    }),
    inTransaction: (value: boolean) => (transaction = value),
  };
}

const event = (stream: string, type: string, data: unknown): DomainEvent => ({
  ...newEvent({ stream, type, actor: { kind: 'system', id: 'test' }, data, occurredAt: 0 }),
  seq: 1,
  v: 1,
});

describe('AccessCache', () => {
  it('reuses rules, subjects and owners until the TTL runs out', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      await t.rules.listForMap('m1');
      await t.subjects.subjectsOf('a1');
      await t.owners.ownerOf('m1');
    }
    expect(t.reads).toEqual({ rules: 1, subjects: 1, owners: 1 });
    t.clock.advance(10_000);
    await t.rules.listForMap('m1');
    expect(t.reads.rules).toBe(2);
  });

  it('forgets what an event says changed', async () => {
    const t = setup();
    await t.rules.listForMap('m1');
    await t.rules.listForMap('m2');
    await t.subjects.subjectsOf('a1');
    t.cache.onEvent(event('map:m1', 'access.rule_added', {}));
    await t.rules.listForMap('m1');
    await t.rules.listForMap('m2');
    expect(t.reads.rules).toBe(3); // m1 again, m2 still cached

    t.cache.onEvent(event('instance', 'access.account_changed', { accountId: 'a1' }));
    await t.subjects.subjectsOf('a1');
    expect(t.reads.subjects).toBe(2);

    await t.owners.ownerOf('m1');
    t.cache.onEvent(event('map:m1', 'map.removed', { id: 'm1' }));
    await t.owners.ownerOf('m1');
    expect(t.reads.owners).toBe(2);
  });

  it('drops a map on its own rule writes and reads fresh inside transactions', async () => {
    const t = setup();
    expect(await t.rules.listForMap('m1')).toHaveLength(1);
    await t.rules.insert(rule('m1', 'r2'));
    expect(await t.rules.listForMap('m1')).toHaveLength(2);
    await t.rules.delete('r1');
    expect(await t.rules.listForMap('m1')).toHaveLength(1);

    t.inTransaction(true);
    const before = t.reads.rules;
    await t.rules.listForMap('m1');
    await t.rules.listForMap('m1');
    expect(t.reads.rules).toBe(before + 2);
  });
});
