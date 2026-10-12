import { afterEach, expect, it, vi } from 'vitest';
import { newEvent, type Actor } from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { ServerMessage } from '@darkbeacon/shared';
import { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from '../adapters/events/kysely-event-log.js';
import { RealtimeHub } from './realtime.hub.js';
import { RealtimeRegistry } from './realtime.registry.js';

const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
const system = { kind: 'system', id: 'test' } as const;

let hubs: RealtimeHub[] = [];
afterEach(() => {
  hubs.forEach((h) => h.close());
  hubs = [];
});

function setup(database: Database, maxReplay = 1000, maxSubscriptions = 50) {
  const bus = new InProcessEventBus();
  const log = new KyselyEventLog(database, bus);
  const registry = new RealtimeRegistry();
  const allowed = { value: true };
  registry.registerStream('map', { authorize: (actor) => allowed.value && actor?.id === 'alice' });
  registry.registerSnapshot('map', async (mapId) => ({ map: { id: mapId } }));
  registry.registerSnapshot('map', async () => ({ systems: [1, 2] }));
  const hub = new RealtimeHub({
    log,
    bus,
    registry,
    database,
    maxReplay,
    maxSubscriptions,
    onError: () => {},
  });
  hubs.push(hub);

  const connect = (actor: Actor | null = alice) => {
    const messages: ServerMessage[] = [];
    const who = { actor, ended: false };
    const conn = hub.connect(
      async () => who.actor,
      (m) => messages.push(m),
      () => (who.ended = true),
    );
    const send = (m: unknown) => conn.receive(JSON.stringify(m));
    const until = (predicate: (m: ServerMessage[]) => boolean) =>
      vi.waitFor(() => expect(predicate(messages)).toBe(true), { timeout: 2000, interval: 5 });
    return { messages, send, until, who, close: () => conn.close() };
  };
  const append = (stream: string, type = 'system.added') =>
    log.append([newEvent({ stream, type, actor: system, data: { type }, occurredAt: Date.now() })]);
  const seqs = (messages: ServerMessage[]) =>
    messages.flatMap((m) => (m.op === 'event' ? [m.event.seq] : []));
  const accountChanged = (accountId: string) =>
    log.append([
      newEvent({
        stream: 'instance',
        type: 'access.account_changed',
        actor: system,
        data: { accountId },
        occurredAt: Date.now(),
      }),
    ]);
  return { hub, log, connect, append, seqs, allowed, accountChanged };
}

describeEachDialect('RealtimeHub', (t) => {
  it('sends a merged snapshot without sinceSeq, then live events', async () => {
    const { connect, append, seqs } = setup(t.db);
    await append('map:m1');
    await append('map:m1');
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1' });
    await c.until((m) => m.some((x) => x.op === 'subscribed'));
    expect(c.messages).toEqual([
      { op: 'snapshot', stream: 'map:m1', seq: 2, data: { map: { id: 'm1' }, systems: [1, 2] } },
      { op: 'subscribed', stream: 'map:m1', seq: 2, mode: 'snapshot' },
    ]);
    await append('map:m1');
    await append('map:other');
    await c.until((m) => seqs(m).length === 1);
    expect(seqs(c.messages)).toEqual([3]);
  });

  it('replays what the client missed, then continues live without gaps or duplicates', async () => {
    const { connect, append, seqs } = setup(t.db);
    for (let i = 0; i < 5; i++) await append('map:m1');
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 2 });
    // Events committed while the replay runs must neither be lost nor duplicated.
    await Promise.all([append('map:m1'), append('map:m1')]);
    await c.until((m) => seqs(m).length === 5);
    expect(seqs(c.messages)).toEqual([3, 4, 5, 6, 7]);
    expect(c.messages.find((m) => m.op === 'subscribed')).toMatchObject({ mode: 'replay' });
    expect(c.messages.some((m) => m.op === 'snapshot')).toBe(false);
  });

  it('falls back to a snapshot when the gap is too large or pruned', async () => {
    const { connect, append, log } = setup(t.db, 3);
    for (let i = 0; i < 5; i++) await append('map:m1');
    const tooFar = connect();
    tooFar.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 1 });
    await tooFar.until((m) => m.some((x) => x.op === 'subscribed'));
    expect(tooFar.messages[0]).toMatchObject({ op: 'snapshot', seq: 5 });

    await log.prune(Date.now() + 1000);
    const pruned = connect();
    pruned.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 4 });
    await pruned.until((m) => m.some((x) => x.op === 'subscribed'));
    expect(pruned.messages[0]).toMatchObject({ op: 'snapshot', seq: 5 });

    const current = connect();
    current.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 5 });
    await current.until((m) => m.some((x) => x.op === 'subscribed'));
    expect(current.messages).toEqual([{ op: 'subscribed', stream: 'map:m1', seq: 5, mode: 'replay' }]);
  });

  it('rejects bad messages, unknown streams and unauthorized actors', async () => {
    const { connect } = setup(t.db);
    const anon = connect(null);
    anon.send({ op: 'subscribe', stream: 'map:m1' });
    anon.send({ op: 'subscribe', stream: 'nope:1' });
    anon.send({ op: 'what' });
    anon.send({ op: 'ping' });
    await anon.until((m) => m.length === 4);
    expect(anon.messages.map((m) => (m.op === 'error' ? m.code : m.op))).toEqual([
      'unauthenticated',
      'unknown_stream',
      'bad_request',
      'pong',
    ]);
  });

  it('drops a subscription when access is revoked', async () => {
    const { connect, append, seqs, allowed } = setup(t.db);
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 0 });
    await c.until((m) => m.some((x) => x.op === 'subscribed'));
    allowed.value = false;
    await append('map:m1', 'access.rule_removed');
    await c.until((m) => m.some((x) => x.op === 'error'));
    await append('map:m1');
    await new Promise((r) => setTimeout(r, 20));
    expect(seqs(c.messages)).toEqual([1]);
    expect(c.messages.at(-1)).toMatchObject({ op: 'error', stream: 'map:m1', code: 'forbidden' });
  });

  it('stops sending after unsubscribe', async () => {
    const { connect, append, seqs } = setup(t.db);
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 0 });
    await c.until((m) => m.some((x) => x.op === 'subscribed'));
    c.send({ op: 'unsubscribe', stream: 'map:m1' });
    await c.until((m) => m.some((x) => x.op === 'unsubscribed'));
    await append('map:m1');
    await new Promise((r) => setTimeout(r, 20));
    expect(seqs(c.messages)).toEqual([]);
  });

  it('limits how many streams one connection follows', async () => {
    const { connect } = setup(t.db, 1000, 2);
    const c = connect();
    for (const stream of ['map:m1', 'map:m2', 'map:m1', 'map:m3'])
      c.send({ op: 'subscribe', stream, sinceSeq: 0 });
    // Subscribing to a followed stream again does not count twice.
    await c.until(
      (m) => m.filter((x) => x.op === 'subscribed').length === 2 && m.some((x) => x.op === 'error'),
    );
    expect(c.messages.find((m) => m.op === 'error')).toMatchObject({
      stream: 'map:m3',
      code: 'bad_request',
      message: 'Too many subscriptions',
    });
  });

  it('re-checks only the connections of an account whose access changed', async () => {
    const { connect, allowed, accountChanged, seqs, append } = setup(t.db);
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 0 });
    await c.until((m) => m.some((x) => x.op === 'subscribed'));
    allowed.value = false;
    await accountChanged('bob');
    await append('map:m1');
    await c.until((m) => seqs(m).length === 1);
    expect(c.messages.some((m) => m.op === 'error')).toBe(false);

    await accountChanged('alice');
    await c.until((m) => m.some((x) => x.op === 'error'));
    expect(c.messages.at(-1)).toMatchObject({ op: 'error', stream: 'map:m1', code: 'forbidden' });
  });

  it('closes a connection whose session ended', async () => {
    const { connect, accountChanged, append, seqs } = setup(t.db);
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 0 });
    await c.until((m) => m.some((x) => x.op === 'subscribed'));
    c.who.actor = null;
    await accountChanged('alice');
    await vi.waitFor(() => expect(c.who.ended).toBe(true));
    await append('map:m1');
    await new Promise((r) => setTimeout(r, 20));
    expect(seqs(c.messages)).toEqual([]);
  });

  it('re-checks every connection on the timer, also without an event', async () => {
    const { hub, connect, allowed } = setup(t.db);
    const c = connect();
    c.send({ op: 'subscribe', stream: 'map:m1', sinceSeq: 0 });
    await c.until((m) => m.some((x) => x.op === 'subscribed'));
    allowed.value = false;
    hub.recheckAll();
    await c.until((m) => m.some((x) => x.op === 'error'));
    expect(c.messages.at(-1)).toMatchObject({ code: 'forbidden' });
  });

  it('sends ephemeral intel to the stream and its views, each under its own name', async () => {
    const { hub, connect } = setup(t.db);
    const registry = (hub as unknown as { options: { registry: RealtimeRegistry } }).options.registry;
    registry.registerStream('public', {
      authorize: () => true,
      view: { source: async () => 'map:m1', project: async (_id, event) => event },
    });
    const member = connect();
    const visitor = connect(null);
    member.send({ op: 'subscribe', stream: 'map:m1' });
    visitor.send({ op: 'subscribe', stream: 'public:tok' });
    await member.until((m) => m.some((x) => x.op === 'subscribed'));
    await visitor.until((m) => m.some((x) => x.op === 'subscribed'));
    expect(hub.followed('map')).toEqual(['m1']);
    hub.broadcast('map:m1', { op: 'intel', stream: 'map:m1', systems: [] });
    expect(member.messages.at(-1)).toEqual({ op: 'intel', stream: 'map:m1', systems: [] });
    // The public view never learns the map's stream name.
    expect(visitor.messages.at(-1)).toEqual({ op: 'intel', stream: 'public:tok', systems: [] });
  });
});
