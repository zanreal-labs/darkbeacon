import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDatabase } from './database.js';
import { bool, isUniqueViolation, json } from './portable.js';
import { describeEachDialect } from './testing.js';

interface Tables {
  event_stream: { stream: string; head_seq: number };
}

describeEachDialect('Database', (t) => {
  it('runs the core migrations', async () => {
    const rows = await t.db.db<Tables>().selectFrom('event_stream').selectAll().execute();
    expect(rows).toEqual([]);
    // A second run applies nothing.
    expect(await t.db.migrate()).toEqual([]);
  });

  it('commits, joins nested transactions and fires afterCommit after commit', async () => {
    const calls: string[] = [];
    await t.db.transaction(async () => {
      await t.db.db<Tables>().insertInto('event_stream').values({ stream: 'a', head_seq: 1 }).execute();
      await t.db.transaction(async () => {
        expect(t.db.inTransaction).toBe(true);
        await t.db.db<Tables>().insertInto('event_stream').values({ stream: 'b', head_seq: 2 }).execute();
      });
      t.db.afterCommit(() => calls.push('committed'));
      expect(calls).toEqual([]);
    });
    expect(calls).toEqual(['committed']);
    const rows = await t.db
      .db<Tables>()
      .selectFrom('event_stream')
      .select('stream')
      .orderBy('stream')
      .execute();
    expect(rows.map((r) => r.stream)).toEqual(['a', 'b']);
  });

  it('rolls back and skips afterCommit on error', async () => {
    const calls: string[] = [];
    await expect(
      t.db.transaction(async () => {
        await t.db.db<Tables>().insertInto('event_stream').values({ stream: 'a', head_seq: 1 }).execute();
        t.db.afterCommit(() => calls.push('committed'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toEqual([]);
    expect(await t.db.db<Tables>().selectFrom('event_stream').selectAll().execute()).toEqual([]);
  });

  it('returns bigint columns as numbers', async () => {
    const big = Date.UTC(2026, 9, 11);
    await t.db.db<Tables>().insertInto('event_stream').values({ stream: 'x', head_seq: big }).execute();
    const row = await t.db.db<Tables>().selectFrom('event_stream').selectAll().executeTakeFirstOrThrow();
    expect(row.head_seq).toBe(big);
  });

  it('detects unique violations', async () => {
    const insert = () =>
      t.db.db<Tables>().insertInto('event_stream').values({ stream: 'dup', head_seq: 1 }).execute();
    await insert();
    const error = await insert().catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });
});

describe('portable helpers', () => {
  it('encodes json and booleans', () => {
    expect(json.decode<{ a: number }>(json.encode({ a: 1 }))).toEqual({ a: 1 });
    expect(json.decode(null)).toBeNull();
    expect(bool.encode(true)).toBe(1);
    expect(bool.decode(0)).toBe(false);
  });

  it('uses WAL for file databases', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const db = await createDatabase({ dataDir: mkdtempSync(`${tmpdir()}/ww-`) });
    const result = await sql<{ journal_mode: string }>`pragma journal_mode`.execute(db.kysely);
    expect(result.rows[0]?.journal_mode).toBe('wal');
    await db.close();
  });
});
