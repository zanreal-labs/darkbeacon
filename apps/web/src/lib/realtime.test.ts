import { describe, expect, it, vi } from 'vitest';
import { RealtimeClient, type StreamMessage } from './realtime.js';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
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

const event = (seq: number) => ({
  op: 'event',
  event: {
    id: `e${seq}`,
    seq,
    stream: 'map:1',
    type: 'system.added',
    occurredAt: 1,
    actor: { kind: 'system', id: 's' },
    data: {},
    v: 1,
  },
});

describe('RealtimeClient', () => {
  it('resumes with sinceSeq after a reconnect and drops duplicates', () => {
    vi.useFakeTimers();
    FakeSocket.all = [];
    const client = new RealtimeClient({
      url: 'ws://x/ws',
      createSocket: () => new FakeSocket(),
      backoff: () => 100,
    });
    const seen: StreamMessage[] = [];
    client.subscribe('map:1', (m) => seen.push(m));
    client.start();
    const first = FakeSocket.all[0]!;
    first.open();
    expect(first.sent).toEqual([{ op: 'subscribe', stream: 'map:1' }]);

    first.push({ op: 'snapshot', stream: 'map:1', seq: 4, data: {} });
    first.push({ op: 'subscribed', stream: 'map:1', seq: 4, mode: 'snapshot' });
    first.push(event(5));
    first.close();

    vi.advanceTimersByTime(100);
    const second = FakeSocket.all[1]!;
    second.open();
    expect(second.sent).toEqual([{ op: 'subscribe', stream: 'map:1', sinceSeq: 5 }]);
    second.push(event(5));
    second.push(event(6));
    expect(seen.map((m) => (m.op === 'event' ? m.event.seq : m.op))).toEqual([
      'snapshot',
      'subscribed',
      5,
      6,
    ]);
    client.stop();
    vi.useRealTimers();
  });

  it('unsubscribes when the last listener leaves', () => {
    FakeSocket.all = [];
    const client = new RealtimeClient({ url: 'ws://x/ws', createSocket: () => new FakeSocket() });
    client.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    const off1 = client.subscribe('instance', () => {});
    const off2 = client.subscribe('instance', () => {});
    off1();
    off2();
    expect(socket.sent).toEqual([
      { op: 'subscribe', stream: 'instance' },
      { op: 'unsubscribe', stream: 'instance' },
    ]);
    client.stop();
  });

  it('resumes from the seq of a server-rendered snapshot instead of asking for a snapshot', () => {
    FakeSocket.all = [];
    const client = new RealtimeClient({ url: 'ws://x/ws', createSocket: () => new FakeSocket() });
    const seen: StreamMessage[] = [];
    client.subscribe('map:1', (m) => seen.push(m), 4);
    client.start();
    const socket = FakeSocket.all[0]!;
    socket.open();
    expect(socket.sent).toEqual([{ op: 'subscribe', stream: 'map:1', sinceSeq: 4 }]);
    socket.push(event(4));
    socket.push(event(5));
    expect(seen.map((m) => (m.op === 'event' ? m.event.seq : m.op))).toEqual([5]);
    client.stop();
  });
});
