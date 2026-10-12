import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalSignals, newEvent, type DomainEvent } from '@darkbeacon/core';
import { createTestDatabase, type TestDatabase } from '@darkbeacon/db/testing';
import { KyselyEventLog } from '../events/kysely-event-log.js';
import { payloads, PostgresEventBus } from './postgres-event-bus.js';
import { PostgresLeadership } from './postgres-leadership.js';
import { PostgresPresenceRelay, split } from './postgres-presence-relay.js';
import { PostgresSignals } from './postgres-signals.js';
import type { PresenceBroadcast } from '../../realtime/presence.js';

const url = process.env.TEST_DATABASE_URL;

describe('cluster notices', () => {
  it('split ranges so every NOTIFY payload stays under the limit', () => {
    const ranges = Array.from(
      { length: 500 },
      (_, i) => [`map:${randomUUID()}`, i, i + 3] as [string, number, number],
    );
    const out = payloads('me', ranges);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((p) => p.length < 8000)).toBe(true);
    expect(out.flatMap((p) => (JSON.parse(p) as { ranges: unknown[] }).ranges)).toEqual(ranges);
  });
});

const crowd = (n: number): PresenceBroadcast => ({
  from: 'one',
  stream: 'map:m',
  left: ['gone'],
  peers: Array.from({ length: n }, (_, i) => ({
    key: randomUUID(),
    identity: {
      accountId: randomUUID(),
      name: `Pilot ${i}`,
      characterId: 2_120_000_000 + i,
      characterName: `Pilot ${i}`,
    },
    shareCursor: true,
    since: 1,
    state: { cursor: { x: i, y: i }, drag: null, editing: null, selection: null },
  })),
});

describe('presence notices', () => {
  it('split a crowded map into notifications under the limit, every peer once', () => {
    const broadcast = crowd(150);
    const parts = split(broadcast).map((p) => JSON.parse(p) as PresenceBroadcast);
    expect(parts.length).toBeGreaterThan(1);
    expect(split(broadcast).every((p) => p.length < 8000)).toBe(true);
    expect(parts.flatMap((p) => p.peers)).toEqual(broadcast.peers);
    expect(parts.flatMap((p) => p.left)).toEqual(['gone']);
  });
});

describe('local signals', () => {
  it('reach this process at once, by topic, until unsubscribed', () => {
    const signals = new LocalSignals();
    const heard: unknown[] = [];
    const stop = signals.subscribe('a', (payload) => heard.push(payload));
    signals.subscribe('b', () => heard.push('wrong topic'));
    signals.publish('a', { n: 1 });
    stop();
    signals.publish('a', { n: 2 });
    expect(heard).toEqual([{ n: 1 }]);
  });
});

describe.skipIf(!url)('clustering on Postgres', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('elects one leader, and another when it goes away', async () => {
    const name = `test:${randomUUID()}`;
    const a = new PostgresLeadership({ url: url!, name, intervalMs: 100 });
    const b = new PostgresLeadership({ url: url!, name, intervalMs: 100 });
    cleanups.push(() => b.stop());
    await a.start();
    await b.start();
    expect([a.isLeader(), b.isLeader()]).toEqual([true, false]);
    const changes: boolean[] = [];
    b.onChange((leader) => changes.push(leader));
    await a.stop();
    await vi.waitFor(() => expect(b.isLeader()).toBe(true), { timeout: 3_000 });
    expect(changes).toEqual([true]);
  });

  it('gets every event to every replica, in order, once', async () => {
    const database: TestDatabase = await createTestDatabase('postgres');
    cleanups.push(() => database.dispose());
    const channel = `dbk_test_${randomUUID().slice(0, 8)}`;
    const replica = () => {
      const bus = new PostgresEventBus({ url: url!, channel });
      const log = new KyselyEventLog(database.db, bus);
      bus.useReader((stream, since, limit) => log.readSince(stream, since, limit));
      cleanups.push(() => bus.stop());
      const seen: string[] = [];
      bus.subscribe((event: DomainEvent) => void seen.push(`${event.stream}#${event.seq}`));
      return { bus, log, seen };
    };
    const one = replica();
    const two = replica();
    await one.bus.start();
    await two.bus.start();

    const event = (stream: string) =>
      newEvent({ stream, type: 'system.added', actor: { kind: 'system', id: 't' }, data: {}, occurredAt: 1 });
    await one.log.append([event('map:a'), event('map:a'), event('map:b')]);
    await two.log.append([event('map:a')]);
    const expected = ['map:a#1', 'map:a#2', 'map:b#1', 'map:a#3'];
    await vi.waitFor(() => {
      expect(one.seen).toEqual(expected);
      // Its own event at once, the other replica's when the notice arrives: each exactly once.
      expect([...two.seen].sort()).toEqual([...expected].sort());
    });
  });

  it('relays presence between replicas', async () => {
    const channel = `dbk_test_${randomUUID().slice(0, 8)}`;
    const one = new PostgresPresenceRelay({ url: url!, channel });
    const two = new PostgresPresenceRelay({ url: url!, channel });
    cleanups.push(
      () => one.stop(),
      () => two.stop(),
    );
    await one.start();
    await two.start();
    const heard: PresenceBroadcast[] = [];
    two.subscribe((broadcast) => heard.push(broadcast));
    const broadcast = crowd(80);
    one.publish(broadcast);
    await vi.waitFor(() => expect(heard.flatMap((b) => b.peers)).toHaveLength(80));
    // Notifications may arrive in any order; each carries whole peers.
    expect(heard.flatMap((b) => b.peers.map((p) => p.key)).sort()).toEqual(
      broadcast.peers.map((p) => p.key).sort(),
    );
  });

  it('signals every replica once, the sender at once', async () => {
    const channel = `dbk_test_${randomUUID().slice(0, 8)}`;
    const one = new PostgresSignals({ url: url!, channel });
    const two = new PostgresSignals({ url: url!, channel });
    cleanups.push(
      () => one.stop(),
      () => two.stop(),
    );
    await one.start();
    await two.start();
    const heardOne: unknown[] = [];
    const heardTwo: unknown[] = [];
    one.subscribe('intel.changed', (payload) => heardOne.push(payload));
    two.subscribe('intel.changed', (payload) => heardTwo.push(payload));
    two.subscribe('other', () => heardTwo.push('wrong topic'));
    one.publish('intel.changed', { systemIds: [1, 2], claims: true });
    expect(heardOne).toEqual([{ systemIds: [1, 2], claims: true }]);
    await vi.waitFor(() => expect(heardTwo).toEqual([{ systemIds: [1, 2], claims: true }]));
    // The sender does not hear its own notification again.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(heardOne).toHaveLength(1);
  });
});
