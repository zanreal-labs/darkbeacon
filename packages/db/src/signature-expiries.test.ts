import { expect, it } from 'vitest';
import { markExpiries } from '../migrations/mapping/0900_signature_expiries.js';
import { describeEachDialect } from './testing.js';

interface Tables {
  maps: {
    id: string;
    slug: string;
    name: string;
    owner_account_id: string;
    settings: string;
    labels: string;
    created_at: number;
    updated_at: number;
  };
  map_tombstones: {
    map_id: string;
    kind: string;
    key: string;
    deleted_at: number;
    reason: string | null;
    expired_from: number | null;
  };
  event_log: {
    id: string;
    stream: string;
    seq: number;
    type: string;
    occurred_at: number;
    actor_kind: string;
    actor_id: string;
    data: string;
    v: number;
    audit: string | null;
  };
}

const HOUR = 60 * 60 * 1000;
const SWEPT = Date.parse('2026-10-16T11:25:44Z');
const HOME = 31001269;

describeEachDialect('migration mapping/0900_signature_expiries', (t) => {
  const db = () => t.db.db<Tables>();
  let seq = 0;
  const map = (id: string, settings = '{}') =>
    db()
      .insertInto('maps')
      .values({
        id,
        slug: id,
        name: id,
        owner_account_id: 'alice',
        settings,
        labels: '[]',
        created_at: 1,
        updated_at: 1,
      })
      .execute();
  const tombstone = (mapId: string, eveId: string, deletedAt: number) =>
    db()
      .insertInto('map_tombstones')
      .values({ map_id: mapId, kind: 'signature', key: `${HOME}:${eveId}`, deleted_at: deletedAt })
      .execute();
  const removal = (mapId: string, eveId: string, at: number, actor: [string, string]) =>
    db()
      .insertInto('event_log')
      .values({
        id: `e${++seq}`,
        stream: `map:${mapId}`,
        seq,
        type: 'signature.removed',
        occurred_at: at,
        actor_kind: actor[0],
        actor_id: actor[1],
        data: JSON.stringify({ id: `s${seq}`, solarSystemId: HOME }),
        v: 1,
        audit: JSON.stringify({ op: 'delete', removed: { id: `s${seq}`, solarSystemId: HOME, eveId } }),
      })
      .execute();
  const read = async (mapId: string) =>
    Object.fromEntries(
      (
        await db()
          .selectFrom('map_tombstones')
          .select(['key', 'reason', 'expired_from'])
          .where('map_id', '=', mapId)
          .execute()
      ).map((r) => [
        r.key.split(':')[1],
        { reason: r.reason, from: r.expired_from == null ? null : Number(r.expired_from) },
      ]),
    );

  it("marks the sweepers' removals as expiries, leaving deletions on purpose as they were", async () => {
    await map('shck');
    await map('slow', JSON.stringify({ signatureRetentionDays: 3 }));
    // The lazy delete's pass: the tombstone a moment before its event, as the sweeper writes them.
    await tombstone('shck', 'VQY-876', SWEPT - 5);
    await removal('shck', 'VQY-876', SWEPT, ['system', 'sweeper']);
    // Swept, then pasted again and deleted by someone: that deletion holds.
    await tombstone('shck', 'TCR-170', SWEPT + HOUR);
    await removal('shck', 'TCR-170', SWEPT, ['system', 'sweeper']);
    // Deleted by someone.
    await tombstone('shck', 'RXG-867', SWEPT);
    await removal('shck', 'RXG-867', SWEPT, ['account', 'alice']);
    // The retention sweep of a map that keeps signatures 3 days, and of one with the default.
    await tombstone('slow', 'QKX-920', SWEPT);
    await removal('slow', 'QKX-920', SWEPT, ['system', 'signature-sweep']);
    await tombstone('shck', 'PYR-195', SWEPT);
    await removal('shck', 'PYR-195', SWEPT, ['system', 'signature-sweep']);

    expect(await markExpiries(t.db.db())).toBe(3);
    expect(await read('shck')).toEqual({
      'VQY-876': { reason: 'expired', from: SWEPT - 24 * HOUR },
      'TCR-170': { reason: null, from: null },
      'RXG-867': { reason: null, from: null },
      'PYR-195': { reason: 'expired', from: SWEPT - 14 * 24 * HOUR },
    });
    expect(await read('slow')).toEqual({ 'QKX-920': { reason: 'expired', from: SWEPT - 3 * 24 * HOUR } });
    // Running again changes nothing.
    expect(await markExpiries(t.db.db())).toBe(0);
  });
});
