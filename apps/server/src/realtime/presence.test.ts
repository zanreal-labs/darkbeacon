import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { PresenceSettingsDto, ServerMessage } from '@darkbeacon/shared';
import { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from '../adapters/events/kysely-event-log.js';
import {
  DEFAULT_PRESENCE_SETTINGS,
  PresenceRooms,
  presenceColor,
  type PresenceMember,
  type PresenceMessage,
} from './presence.js';
import { RealtimeHub } from './realtime.hub.js';
import { RealtimeRegistry } from './realtime.registry.js';

const member = (key: string, accountId: string, settings = DEFAULT_PRESENCE_SETTINGS) => {
  const inbox: PresenceMessage[] = [];
  const m: PresenceMember = {
    key,
    identity: { accountId, name: accountId, characterId: null, characterName: `${accountId} main` },
    settings,
    send: (message: PresenceMessage, _text: string) => {
      inbox.push(message);
    },
  };
  return { m, inbox };
};

describe('PresenceRooms', () => {
  let rooms: PresenceRooms;
  afterEach(() => rooms.close());

  it('sends the joiner everyone else at once and coalesces updates per flush', () => {
    rooms = new PresenceRooms({ now: () => 1000 });
    const a = member('ka', 'alice');
    const b = member('kb', 'bob');
    rooms.update('map:m', a.m, {});
    expect(a.inbox).toEqual([{ op: 'presence', stream: 'map:m', full: true, peers: [], left: [] }]);
    rooms.update('map:m', b.m, { cursor: { x: 1, y: 1 } });
    expect(b.inbox[0]).toMatchObject({ full: true, peers: [{ key: 'ka', name: 'alice', cursor: null }] });

    // Many moves between two flushes reach the others as one message with the latest state.
    for (let i = 0; i < 50; i++) rooms.update('map:m', b.m, { cursor: { x: i, y: i } });
    rooms.update('map:m', b.m, { editing: { kind: 'system', id: '31000005', field: 'status' } });
    rooms.flush();
    expect(a.inbox).toHaveLength(2);
    expect(a.inbox[1]).toMatchObject({
      full: false,
      left: [],
      peers: [
        {
          key: 'kb',
          accountId: 'bob',
          characterName: 'bob main',
          color: presenceColor('bob'),
          cursor: { x: 49, y: 49 },
          editing: { kind: 'system', id: '31000005', field: 'status' },
          since: 1000,
        },
      ],
    });
    // Nothing changed: nothing is sent.
    rooms.flush();
    expect(a.inbox).toHaveLength(2);

    rooms.leave('map:m', 'kb');
    rooms.flush();
    expect(a.inbox[2]).toEqual({ op: 'presence', stream: 'map:m', full: false, peers: [], left: ['kb'] });
    expect(rooms.here('map:m').map((p) => p.name)).toEqual(['alice']);
  });

  it('keeps cursors to itself when sharing is off, and from viewers who hide others', () => {
    rooms = new PresenceRooms();
    const a = member('ka', 'alice');
    const b = member('kb', 'bob', { shareCursor: false, showOthers: true });
    rooms.update('map:m', a.m, {});
    rooms.update('map:m', b.m, { cursor: { x: 5, y: 5 }, selection: { systems: [1], connections: [] } });
    rooms.flush();
    expect(a.inbox.at(-1)).toMatchObject({
      peers: [{ key: 'kb', cursor: null, selection: { systems: [1] } }],
    });

    // Bob shares again: Alice gets his cursor without him moving.
    rooms.applySettings('bob', DEFAULT_PRESENCE_SETTINGS);
    rooms.flush();
    expect(a.inbox.at(-1)).toMatchObject({ peers: [{ key: 'kb', cursor: { x: 5, y: 5 } }] });

    // Alice hides others: she still sees who is here, not where they point.
    rooms.applySettings('alice', { shareCursor: true, showOthers: false });
    expect(a.inbox.at(-1)).toMatchObject({ full: true, peers: [{ key: 'kb', cursor: null }] });
  });

  it('sends changes as patches, serialized once for every viewer', () => {
    rooms = new PresenceRooms({ now: () => 1000 });
    const texts: string[] = [];
    const viewers = Array.from({ length: 3 }, (_, i) => {
      const v = member(`k${i}`, `v${i}`);
      const send = v.m.send;
      v.m.send = (message, text) => {
        texts.push(text);
        send(message, text);
      };
      return v;
    });
    const mover = member('km', 'mover');
    for (const v of viewers) rooms.update('map:m', v.m, {});
    rooms.update('map:m', mover.m, { selection: { systems: [1], connections: [] } });
    rooms.flush();
    texts.length = 0;

    rooms.update('map:m', mover.m, { cursor: { x: 3, y: 4 } });
    rooms.flush();
    // Only the key and the cursor: nothing about who it is, nor the unchanged selection.
    for (const v of viewers)
      expect(v.inbox.at(-1)).toEqual({
        op: 'presence',
        stream: 'map:m',
        full: false,
        peers: [{ key: 'km', cursor: { x: 3, y: 4 } }],
        left: [],
      });
    expect(texts).toHaveLength(3);
    for (const [i, text] of texts.entries()) expect(JSON.parse(text)).toEqual(viewers[i]!.inbox.at(-1));

    // A viewer who hides others hears nothing about a cursor move.
    rooms.applySettings('v0', { shareCursor: true, showOthers: false });
    rooms.flush();
    const before = viewers[0]!.inbox.length;
    rooms.update('map:m', mover.m, { cursor: { x: 5, y: 6 } });
    rooms.flush();
    expect(viewers[0]!.inbox).toHaveLength(before);
    expect(viewers[1]!.inbox.at(-1)).toMatchObject({ peers: [{ key: 'km', cursor: { x: 5, y: 6 } }] });
  });

  it('flushes crowded maps less often, so a viewer gets at most the peer budget', () => {
    let now = 0;
    rooms = new PresenceRooms({ now: () => now, hz: 15, peerBudget: 600 });
    expect(rooms.roomIntervalMs(2)).toBe(67);
    expect(rooms.roomIntervalMs(41)).toBe(67);
    expect(rooms.roomIntervalMs(101)).toBe(167);
    expect(rooms.roomIntervalMs(150)).toBe(248);
    expect(rooms.roomIntervalMs(1000)).toBe(250);

    const people = Array.from({ length: 150 }, (_, i) => member(`k${i}`, `a${i}`));
    for (const p of people) rooms.update('map:m', p.m, {});
    rooms.flush();
    const received = () => people[0]!.inbox.length;
    const start = received();
    // One second of everyone moving, with the timer's ticks every 67 ms.
    for (now = 1; now <= 1000; now += 67) {
      for (const p of people) rooms.update('map:m', p.m, { cursor: { x: now, y: 1 } });
      rooms.flush(false);
    }
    const flushes = received() - start;
    expect(flushes).toBeLessThanOrEqual(5);
    expect(flushes * 149).toBeLessThanOrEqual(600 + 149);
    // The latest position always gets through.
    rooms.flush();
    expect(people[0]!.inbox.at(-1)!.peers.find((p) => p.key === 'k1')?.cursor?.x).toBe(now - 67);
  });

  it('tells listeners (plugins) about arrivals, departures and editing, not cursor moves', () => {
    rooms = new PresenceRooms();
    const heard: string[][] = [];
    rooms.onChange((_stream, here) => heard.push(here.map((p) => `${p.name}:${p.editing?.id ?? '-'}`)));
    const a = member('ka', 'alice');
    rooms.update('map:m', a.m, {});
    rooms.flush();
    rooms.update('map:m', a.m, { cursor: { x: 1, y: 2 } });
    rooms.flush();
    rooms.update('map:m', a.m, { editing: { kind: 'connection', id: 'c1' } });
    rooms.flush();
    rooms.leave('map:m', 'ka');
    rooms.flush();
    expect(heard).toEqual([['alice:-'], ['alice:c1'], []]);
  });
});

const alice: Actor = { kind: 'account', id: 'alice', instanceRole: 'user' };
const bob: Actor = { kind: 'account', id: 'bob', instanceRole: 'user' };

describeEachDialect('presence over the realtime hub', (t) => {
  let hub: RealtimeHub | undefined;
  let rooms: PresenceRooms | undefined;
  afterEach(() => {
    hub?.close();
    rooms?.close();
  });

  function setup() {
    const bus = new InProcessEventBus();
    const log = new KyselyEventLog(t.db, bus);
    const registry = new RealtimeRegistry();
    const allowed = new Set(['alice', 'bob']);
    registry.registerStream('map', { authorize: (actor) => !!actor && allowed.has(actor.id) });
    registry.registerSnapshot('map', async () => ({}));
    const settings = new Map<string, PresenceSettingsDto>();
    rooms = new PresenceRooms({ hz: 50 });
    hub = new RealtimeHub({
      log,
      bus,
      registry,
      database: t.db,
      presence: {
        rooms,
        identify: async (accountId) => ({
          accountId,
          name: accountId,
          characterId: null,
          characterName: null,
        }),
        settings: async (accountId) => settings.get(accountId) ?? DEFAULT_PRESENCE_SETTINGS,
      },
      onError: () => {},
    });
    const connect = (actor: Actor) => {
      const messages: ServerMessage[] = [];
      const who = { actor: actor as Actor | null };
      const conn = hub!.connect(
        async () => who.actor,
        (m) => messages.push(m),
      );
      const send = (m: unknown) => conn.receive(JSON.stringify(m));
      const until = (predicate: (m: ServerMessage[]) => boolean) =>
        vi.waitFor(() => expect(predicate(messages)).toBe(true), { timeout: 2000, interval: 5 });
      const presence = () => messages.filter((m): m is PresenceMessage => m.op === 'presence');
      return { messages, send, until, presence, who, close: () => conn.close() };
    };
    return { hub: hub!, connect, allowed };
  }

  it('shows two clients each other, live, and forgets whoever leaves', async () => {
    const { connect, allowed, hub: h } = setup();
    const a = connect(alice);
    const b = connect(bob);
    for (const c of [a, b]) {
      c.send({ op: 'subscribe', stream: 'map:m' });
      await c.until((m) => m.some((x) => x.op === 'subscribed'));
    }
    a.send({ op: 'presence', stream: 'map:m', state: {} });
    await a.until(() => a.presence().length === 1);
    b.send({ op: 'presence', stream: 'map:m', state: { cursor: { x: 10, y: 20 } } });
    await b.until(() => b.presence().length === 1);
    expect(b.presence()[0]).toMatchObject({ full: true, peers: [{ accountId: 'alice' }] });
    // Alice sees Bob arrive, then his cursor and his drag preview, never herself.
    await a.until(() => a.presence().some((p) => p.peers.some((x) => x.accountId === 'bob')));
    b.send({
      op: 'presence',
      stream: 'map:m',
      state: { cursor: { x: 11, y: 21 }, drag: { systems: [{ solarSystemId: 31000005, x: 300, y: 40 }] } },
    });
    await a.until(() =>
      a.presence().some((p) => p.peers.some((x) => x.cursor?.x === 11 && x.drag?.systems[0]?.x === 300)),
    );
    expect(a.presence().every((p) => p.peers.every((x) => x.accountId !== 'alice'))).toBe(true);

    // Bob turns sharing off: Alice keeps seeing him, without a cursor.
    h.presenceSettingsChanged('bob', { shareCursor: false, showOthers: true });
    await a.until(() =>
      a
        .presence()
        .at(-1)!
        .peers.some((x) => x.accountId === 'bob' && x.cursor === null),
    );

    // Presence needs the map stream: unknown streams and other kinds are ignored.
    a.send({ op: 'presence', stream: 'map:other', state: {} });
    a.send({ op: 'presence', stream: 'instance', state: {} });

    // Bob loses access: the re-check drops his subscription and he leaves the room.
    const bobKey = a
      .presence()
      .flatMap((p) => p.peers)
      .find((x) => x.accountId === 'bob')!.key;
    allowed.delete('bob');
    h.recheckAll();
    await a.until(() => a.presence().some((p) => p.left.includes(bobKey)));
    expect(rooms!.here('map:m').map((p) => p.accountId)).toEqual(['alice']);
    expect(rooms!.here('map:other')).toEqual([]);

    // Closing the socket leaves too.
    a.close();
    expect(rooms!.here('map:m')).toEqual([]);
  });

  it('ignores presence from anonymous sockets and sockets that do not follow the map', async () => {
    const { connect } = setup();
    const a = connect(alice);
    a.send({ op: 'presence', stream: 'map:m', state: { cursor: { x: 1, y: 1 } } });
    a.send({ op: 'presence', stream: 'map:m', state: { cursor: 'nope' } });
    await a.until((m) => m.some((x) => x.op === 'error' && x.code === 'bad_request'));
    expect(rooms!.here('map:m')).toEqual([]);
  });
});
