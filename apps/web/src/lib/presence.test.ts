import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PresencePeerDto } from '@darkbeacon/shared';
import { editorsOf, peopleOf, PresenceStore } from './presence.js';
import { RealtimeClient } from './realtime.js';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const peer = (key: string, accountId: string, extra: Partial<PresencePeerDto> = {}): PresencePeerDto => ({
  key,
  accountId,
  name: accountId,
  characterId: null,
  characterName: null,
  color: 1,
  since: 1,
  cursor: null,
  drag: null,
  editing: null,
  selection: null,
  ...extra,
});

function connected() {
  FakeSocket.all = [];
  const client = new RealtimeClient({
    url: 'ws://x/ws',
    createSocket: () => new FakeSocket(),
    backoff: () => 100,
  });
  client.start();
  const socket = FakeSocket.all[0]!;
  socket.open();
  return { client, socket };
}

afterEach(() => vi.useRealTimers());

describe('PresenceStore', () => {
  it('joins on the map stream, keeps the others and leaves with the view', () => {
    const { client, socket } = connected();
    const store = new PresenceStore(client, 'map:1');
    const seen: Array<readonly PresencePeerDto[]> = [];
    store.subscribe(() => seen.push(store.getSnapshot()));
    store.start();
    expect(socket.sent).toEqual([
      { op: 'subscribe', stream: 'map:1' },
      { op: 'presence', stream: 'map:1', state: {} },
    ]);

    socket.push({ op: 'presence', stream: 'map:1', full: true, peers: [peer('a', 'alice')], left: [] });
    socket.push({
      op: 'presence',
      stream: 'map:1',
      full: false,
      peers: [peer('b', 'bob', { since: 2, cursor: { x: 1, y: 2 } })],
      left: [],
    });
    expect(store.getSnapshot().map((p) => p.key)).toEqual(['a', 'b']);
    // Other streams' presence does not reach this store.
    socket.push({ op: 'presence', stream: 'map:2', full: true, peers: [], left: [] });
    socket.push({ op: 'presence', stream: 'map:1', full: false, peers: [], left: ['a'] });
    expect(store.getSnapshot().map((p) => p.key)).toEqual(['b']);
    expect(seen).toHaveLength(3);

    store.stop();
    expect(socket.sent.slice(-2)).toEqual([
      { op: 'presence.leave', stream: 'map:1' },
      { op: 'unsubscribe', stream: 'map:1' },
    ]);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('merges patches into the peers it knows and ignores patches of peers it never saw', () => {
    const { client, socket } = connected();
    const store = new PresenceStore(client, 'map:1');
    store.start();
    socket.push({
      op: 'presence',
      stream: 'map:1',
      full: true,
      peers: [peer('a', 'alice', { cursor: { x: 1, y: 1 }, editing: { kind: 'map', id: 'm' } })],
      left: [],
    });
    // Only the cursor changed: the rest of Alice stays as it was.
    socket.push({
      op: 'presence',
      stream: 'map:1',
      full: false,
      peers: [{ key: 'a', cursor: { x: 9, y: 8 } }],
      left: [],
    });
    socket.push({
      op: 'presence',
      stream: 'map:1',
      full: false,
      peers: [{ key: 'zz', cursor: { x: 1, y: 1 } }],
      left: [],
    });
    expect(store.getSnapshot()).toEqual([
      { ...peer('a', 'alice'), cursor: { x: 9, y: 8 }, editing: { kind: 'map', id: 'm' } },
    ]);
    store.stop();
  });

  it('sends at most 15 updates a second, the latest state winning', () => {
    vi.useFakeTimers();
    const { client, socket } = connected();
    let now = 0;
    const store = new PresenceStore(client, 'map:1', { now: () => now });
    store.start();
    const presence = () => socket.sent.filter((m) => m.op === 'presence').slice(1);

    // 200 moves a second right after joining: nothing goes out before the interval is up ...
    for (let i = 1; i <= 20; i++) {
      now += 3;
      store.update({ cursor: { x: i, y: i } });
    }
    store.update({ editing: { kind: 'system', id: '31000005' } });
    expect(presence()).toEqual([]);
    // ... then one message with the latest of everything.
    now = 67;
    vi.advanceTimersByTime(67);
    expect(presence()).toEqual([
      {
        op: 'presence',
        stream: 'map:1',
        state: { cursor: { x: 20, y: 20 }, editing: { kind: 'system', id: '31000005' } },
      },
    ]);
    // After a quiet moment an update goes out at once.
    now = 500;
    store.update({ cursor: null });
    expect(presence()).toHaveLength(2);
    expect(presence()[1]).toEqual({ op: 'presence', stream: 'map:1', state: { cursor: null } });
    store.stop();
  });

  it('joins again with its last state after a reconnect, and forgets the others while offline', () => {
    vi.useFakeTimers();
    const { client, socket } = connected();
    const store = new PresenceStore(client, 'map:1', { now: () => 1_000_000 });
    store.start({ cursor: { x: 5, y: 5 } });
    socket.push({ op: 'presence', stream: 'map:1', full: true, peers: [peer('a', 'alice')], left: [] });
    store.update({ selection: { systems: [1], connections: [] } });
    vi.advanceTimersByTime(100);

    socket.close();
    expect(store.getSnapshot()).toEqual([]);
    vi.advanceTimersByTime(100);
    const next = FakeSocket.all[1]!;
    next.open();
    expect(next.sent).toEqual([
      { op: 'subscribe', stream: 'map:1' },
      {
        op: 'presence',
        stream: 'map:1',
        state: { cursor: { x: 5, y: 5 }, selection: { systems: [1], connections: [] } },
      },
    ]);
    store.stop();
  });
});

describe('people and editors', () => {
  it('groups tabs per person and finds who edits what', () => {
    const peers = [
      peer('a1', 'alice', { since: 3 }),
      peer('b1', 'bob', { since: 1, editing: { kind: 'system', id: '7', field: 'status' } }),
      peer('a2', 'alice', { since: 2, editing: { kind: 'signature', id: 's1' } }),
    ];
    expect(peopleOf(peers).map((p) => [p.name, p.tabs, p.editing?.kind ?? null])).toEqual([
      ['bob', 1, 'system'],
      ['alice', 2, 'signature'],
    ]);
    expect(editorsOf(peers, 'system', '7').map((p) => p.key)).toEqual(['b1']);
    expect(editorsOf(peers, 'system', '7', 'tag')).toEqual([]);
  });
});
