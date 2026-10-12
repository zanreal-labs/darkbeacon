import { afterEach, expect, it, vi } from 'vitest';
import { ManualClock, newEvent, type DomainEvent } from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { InProcessEventBus } from '../adapters/events/in-process-event-bus.js';
import { KyselyEventLog } from '../adapters/events/kysely-event-log.js';
import { EventConsumers, type EventConsumer } from './event-consumers.js';

let running: EventConsumers[] = [];
afterEach(async () => {
  for (const consumers of running) await consumers.onModuleDestroy();
  running = [];
});

describeEachDialect('EventConsumers', (t) => {
  const setup = (database: Database) => {
    const bus = new InProcessEventBus(() => undefined);
    const log = new KyselyEventLog(database, bus);
    const append = (stream: string, type = 'system.added') =>
      log.append([newEvent({ stream, type, actor: { kind: 'system', id: 't' }, data: {}, occurredAt: 1 })]);
    const start = async (...consumers: EventConsumer[]) => {
      const runner = new EventConsumers(database, log, bus, new ManualClock());
      for (const consumer of consumers) runner.register(consumer);
      await runner.onApplicationBootstrap();
      running.push(runner);
      return runner;
    };
    return { log, append, start };
  };

  const recorder = (name: string, extra: Partial<EventConsumer> = {}) => {
    const seen: string[] = [];
    const consumer: EventConsumer = {
      name,
      streams: ['map'],
      handle: async (event: DomainEvent) => {
        seen.push(`${event.stream}#${event.seq}`);
      },
      ...extra,
    };
    return { consumer, seen };
  };

  it('starts at the current heads and resumes after a restart', async () => {
    const { append, start } = setup(t.db);
    await append('map:a');
    const first = recorder('test');
    const runner = await start(first.consumer);
    await append('map:a');
    await append('map:b');
    await append('instance');
    await runner.wake();
    expect(first.seen.sort()).toEqual(['map:a#2', 'map:b#1']);

    // Stopped: events committed meanwhile are handled by the next process.
    await runner.onModuleDestroy();
    await append('map:a');
    await append('map:c');
    const second = recorder('test');
    await start(second.consumer);
    expect(second.seen.sort()).toEqual(['map:a#3', 'map:c#1']);
  });

  it('filters by type and commits the handler writes with the cursor', async () => {
    const { log, append, start } = setup(t.db);
    const failing = recorder('failing', {
      types: ['connection.*'],
      handle: async (event) => {
        await append('map:side-effect');
        if (event.seq === 2) throw new Error('nope');
      },
    });
    const runner = await start(failing.consumer);
    await append('map:a', 'connection.added');
    await append('map:a', 'connection.added');
    await append('map:a', 'system.added');
    for (let i = 0; i < 6; i++) await runner.wake();
    // The first event committed its write; the failing one rolled back five times and was skipped.
    expect(await log.headSeq('map:side-effect')).toBe(1);
    await append('map:a', 'connection.removed');
    await runner.wake();
    expect(await log.headSeq('map:side-effect')).toBe(2);
  });

  it('handles events in batches, and one at a time around a failing one', async () => {
    const { log, append, start } = setup(t.db);
    let calls = 0;
    const batched = recorder('batched', {
      types: ['connection.*'],
      handle: async (event) => {
        calls++;
        await append('map:side-effect');
        if (event.seq === 10) throw new Error('nope');
      },
    });
    const runner = await start(batched.consumer);
    // Committed in one transaction, so the bus wakes the consumer once for all of them.
    await log.append(
      Array.from({ length: 30 }, () =>
        newEvent({
          stream: 'map:a',
          type: 'connection.added',
          actor: { kind: 'system', id: 't' },
          data: {},
          occurredAt: 1,
        }),
      ),
    );
    await runner.wake();
    // The first batch (1-25) failed and rolled back; 1-9 then committed one by one, 10 waits.
    expect(await log.headSeq('map:side-effect')).toBe(9);
    for (let i = 0; i < 5; i++) await runner.wake();
    // 10 was skipped after five tries; 11-30 went through.
    expect(await log.headSeq('map:side-effect')).toBe(29);
    const before = calls;
    await runner.wake();
    expect(calls).toBe(before);
  });

  it('wakes only the consumers that want an event', async () => {
    const { append, start } = setup(t.db);
    const instance = recorder('instance-only', { streams: ['instance'] });
    const connections = recorder('connections', { types: ['connection.*'] });
    await start(instance.consumer, connections.consumer);
    await append('map:a', 'connection.added');
    await append('instance', 'access.role_changed');
    await vi.waitFor(() => {
      expect(instance.seen).toEqual(['instance#1']);
      expect(connections.seen).toEqual(['map:a#1']);
    });
  });
});
