import { describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { cachePreparedStatements, createDatabase } from './database.js';
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

  it('reads outside a transaction without waiting for one, and sees every commit', async () => {
    const db = t.db.db<Tables>();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const writing = t.db.transaction(async () => {
      await t.db.db<Tables>().insertInto('event_stream').values({ stream: 'w', head_seq: 1 }).execute();
      await held; // a transaction waiting on something else (the network, another query)
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Not blocked by the open transaction, and its write is not visible yet.
    expect(await db.selectFrom('event_stream').selectAll().execute()).toEqual([]);
    release();
    await writing;
    expect(await db.selectFrom('event_stream').select('stream').execute()).toEqual([{ stream: 'w' }]);

    // Writes outside a transaction wait for the writer and are read back at once.
    await db.insertInto('event_stream').values({ stream: 'x', head_seq: 2 }).execute();
    expect(await db.selectFrom('event_stream').select('stream').orderBy('stream').execute()).toHaveLength(2);
  });

  it('runs read-only transactions that see one state and refuse writes', async () => {
    await t.db.db<Tables>().insertInto('event_stream').values({ stream: 'a', head_seq: 1 }).execute();
    const seen = await t.db.transaction(
      async () => {
        const first = await t.db.db<Tables>().selectFrom('event_stream').selectAll().execute();
        await t.db.db<Tables>().selectFrom('event_stream').selectAll().execute();
        return first;
      },
      { isolation: 'repeatable read', readOnly: true },
    );
    expect(seen).toHaveLength(1);
    await expect(
      t.db.transaction(
        () => t.db.db<Tables>().insertInto('event_stream').values({ stream: 'b', head_seq: 1 }).execute(),
        { readOnly: true },
      ),
    ).rejects.toThrow();
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

  it('uses WAL for file databases, checkpointed off the event loop', async () => {
    const { mkdtempSync, statSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/dbk-`);
    const db = await createDatabase({ dataDir: dir });
    const result = await sql<{ journal_mode: string }>`pragma journal_mode`.execute(db.kysely);
    expect(result.rows[0]?.journal_mode).toBe('wal');
    const auto = await sql<{ wal_autocheckpoint: number }>`pragma wal_autocheckpoint`.execute(db.kysely);
    expect(auto.rows[0]?.wal_autocheckpoint).toBe(100000);

    // Commits leave pages in the WAL; the checkpointer copies them into the database file.
    await db.migrate();
    const before = statSync(`${dir}/app.db`).size;
    await db
      .db<Tables>()
      .insertInto('event_stream')
      .values(Array.from({ length: 2000 }, (_, i) => ({ stream: `${'s'.repeat(200)}${i}`, head_seq: i })))
      .execute();
    await vi.waitFor(() => expect(statSync(`${dir}/app.db`).size).toBeGreaterThan(before), {
      timeout: 5_000,
      interval: 100,
    });
    await db.close();
  });

  it('reuses prepared statements on SQLite, and a fresh one while a statement is busy', async () => {
    const SQLite = (await import('better-sqlite3')).default;
    const sqlite = new SQLite(':memory:');
    let prepared = 0;
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = ((source: string) => {
      prepared++;
      return prepare(source);
    }) as typeof sqlite.prepare;
    cachePreparedStatements(sqlite, 2);
    sqlite.prepare('create table t (n integer)').run();
    const insert = sqlite.prepare('insert into t values (?)');
    for (let i = 0; i < 5; i++) sqlite.prepare('insert into t values (?)').run(i);
    expect(sqlite.prepare('insert into t values (?)')).toBe(insert);
    expect(prepared).toBe(2);

    // While one iteration runs, the same query gets its own statement.
    const select = 'select n from t order by n';
    const outer = [];
    for (const row of sqlite.prepare(select).iterate()) {
      outer.push(row);
      if (outer.length === 1) expect(sqlite.prepare(select).all()).toHaveLength(5);
    }
    expect(outer).toHaveLength(5);

    // Only the most recently used are kept.
    sqlite.prepare('select 1').get();
    sqlite.prepare('select 2').get();
    expect(sqlite.prepare('insert into t values (?)')).not.toBe(insert);
    sqlite.close();
  });
});
