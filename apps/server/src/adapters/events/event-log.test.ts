import { describe, expect, it } from 'vitest';
import { newEvent, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { InProcessEventBus } from './in-process-event-bus.js';
import { KyselyEventLog } from './kysely-event-log.js';

const actor = { kind: 'system', id: 'test' } as const;
const ev = (stream: string, type = 'system.added', occurredAt = 1000) =>
  newEvent({ stream, type, actor, data: { n: type }, occurredAt });

function setup(database: ConstructorParameters<typeof KyselyEventLog>[0]) {
  const bus = new InProcessEventBus();
  const published: DomainEvent[] = [];
  bus.subscribe((e) => {
    published.push(e);
  });
  return { log: new KyselyEventLog(database, bus), published };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describeEachDialect('KyselyEventLog', (t) => {
  it('assigns per-stream seqs and reads them back', async () => {
    const { log } = setup(t.db);
    const first = await log.append([ev('map:a'), ev('map:b'), ev('map:a', 'system.updated')]);
    expect(first.map((e) => [e.stream, e.seq])).toEqual([
      ['map:a', 1],
      ['map:b', 1],
      ['map:a', 2],
    ]);
    await log.append([ev('map:a', 'system.removed')]);

    const read = await log.readSince('map:a', 1);
    expect(read.map((e) => [e.seq, e.type])).toEqual([
      [2, 'system.updated'],
      [3, 'system.removed'],
    ]);
    expect(read[0]).toMatchObject({ actor, data: { n: 'system.updated' }, v: 1, occurredAt: 1000 });
    expect(await log.headSeq('map:a')).toBe(3);
    expect(await log.headSeq('map:none')).toBe(0);
    expect(await log.oldestSeq('map:a')).toBe(1);
    expect(await log.oldestSeq('map:none')).toBeNull();
  });

  it('publishes only after commit, and nothing on rollback', async () => {
    const { log, published } = setup(t.db);
    await t.db.transaction(async () => {
      await log.append([ev('instance')]);
      await flush();
      expect(published).toHaveLength(0);
    });
    await flush();
    expect(published.map((e) => e.seq)).toEqual([1]);

    await expect(
      t.db.transaction(async () => {
        await log.append([ev('instance')]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await flush();
    expect(published).toHaveLength(1);
    // The rolled back append did not consume a seq.
    expect((await log.append([ev('instance')]))[0]?.seq).toBe(2);
  });

  it('keeps seqs unique under concurrent appends', async () => {
    const { log } = setup(t.db);
    await Promise.all(Array.from({ length: 20 }, () => log.append([ev('map:c'), ev('map:c')])));
    const seqs = (await log.readSince('map:c', 0)).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('prunes old events without resetting the head', async () => {
    const { log } = setup(t.db);
    await log.append([ev('map:d', 'a', 100), ev('map:d', 'b', 200), ev('map:d', 'c', 300)]);
    expect(await log.prune(250)).toBe(2);
    expect(await log.oldestSeq('map:d')).toBe(3);
    expect(await log.headSeq('map:d')).toBe(3);
    expect((await log.append([ev('map:d')]))[0]?.seq).toBe(4);
  });
});

describe('InProcessEventBus', () => {
  it('filters and isolates failing handlers', async () => {
    const errors: unknown[] = [];
    const bus = new InProcessEventBus((e) => errors.push(e));
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('bad handler');
    });
    const off = bus.subscribe((e) => void seen.push(e.type), { types: ['system.*'] });
    const event = (type: string) => ({ ...ev('map:a', type), seq: 1, v: 1 }) as DomainEvent;
    bus.publish([event('system.added'), event('connection.added')]);
    await flush();
    expect(seen).toEqual(['system.added']);
    expect(errors).toHaveLength(2);
    off();
    bus.publish([event('system.removed')]);
    await flush();
    expect(seen).toEqual(['system.added']);
  });
});
