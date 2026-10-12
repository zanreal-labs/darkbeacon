import { describe, expect, it } from 'vitest';
import { newEvent, type DomainEvent } from '@darkbeacon/core';
import { describeEachDialect } from '@darkbeacon/db/testing';
import { AuditStamper } from '@darkbeacon/audit';
import { AsyncAuditScope } from '../../platform/audit.js';
import { InProcessEventBus } from './in-process-event-bus.js';
import { eventHash, KyselyEventLog, type EventTables } from './kysely-event-log.js';

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

  it('stores an audit record, refs and a hash chain with each event, never publishing `before`', async () => {
    const bus = new InProcessEventBus();
    const published: DomainEvent[] = [];
    bus.subscribe((e) => void published.push(e));
    const scope = new AsyncAuditScope();
    const log = new KyselyEventLog(t.db, bus, {
      scope,
      stamper: new AuditStamper({
        account: async () => ({ name: 'Alice', mainCharacterId: 7, mainCharacterName: 'Alice Main' }),
        character: async () => null,
      }),
    });
    const before = { id: 'c1', source: 1, target: 2, massStatus: 'fresh', updatedAt: 1 };
    const stored = await scope.run(
      { channel: { kind: 'web' }, origin: { country: 'DE', userAgent: 'ua' } },
      () =>
        log.append([
          newEvent({
            stream: 'map:h',
            type: 'connection.updated',
            actor: { kind: 'account', id: 'a' },
            data: { ...before, massStatus: 'critical', updatedAt: 2 },
            before,
            occurredAt: 10,
          }),
          ev('map:h', 'system.added', 11),
        ]),
    );
    expect(stored[0]).not.toHaveProperty('before');
    await flush();
    expect(published).toHaveLength(2);
    expect(published.every((e) => !('before' in e))).toBe(true);

    const rows = await t.db
      .db<EventTables>()
      .selectFrom('event_log')
      .selectAll()
      .where('stream', '=', 'map:h')
      .orderBy('seq')
      .execute();
    const audit = JSON.parse(rows[0]!.audit!) as Record<string, unknown>;
    expect(audit).toMatchObject({
      actor: { kind: 'account', id: 'a', accountName: 'Alice', characterId: 7, characterName: 'Alice Main' },
      channel: { kind: 'web', id: null },
      origin: { country: 'DE', userAgent: 'ua' },
      op: 'update',
      entity: { kind: 'connection', id: 'c1' },
      diff: { massStatus: { before: 'fresh', after: 'critical' } },
    });
    // Chained: the first row starts the stream, every hash covers its row and the one before.
    expect(rows[0]!.prev_hash).toBeNull();
    expect(rows[1]!.prev_hash).toBe(rows[0]!.hash);
    for (const row of rows) expect(eventHash({ ...row, seq: Number(row.seq) })).toBe(row.hash);
    const head = await t.db
      .db<EventTables>()
      .selectFrom('event_stream')
      .select('head_hash')
      .where('stream', '=', 'map:h')
      .executeTakeFirstOrThrow();
    expect(head.head_hash).toBe(rows[1]!.hash);
    const refs = await t.db
      .db<EventTables>()
      .selectFrom('event_ref')
      .select('ref')
      .where('seq', '=', 1)
      .where('stream', '=', 'map:h')
      .execute();
    expect(refs.map((r) => r.ref).sort()).toEqual([
      'account:a',
      'character:7',
      'connection:c1',
      'system:1',
      'system:2',
    ]);

    // Pruning removes the refs with their events.
    expect(await log.prune(11)).toBe(1);
    const left = await t.db
      .db<EventTables>()
      .selectFrom('event_ref')
      .select('seq')
      .where('stream', '=', 'map:h')
      .execute();
    expect(left.every((r) => Number(r.seq) === 2)).toBe(true);
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
