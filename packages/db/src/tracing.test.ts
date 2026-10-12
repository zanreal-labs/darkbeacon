import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDatabase } from './database.js';
import { sqlOperation, type QueryTracer, type TracedStatement } from './tracing.js';

describe('query tracing', () => {
  it('runs every statement through the tracer, transactions and failures included', async () => {
    const seen: Array<TracedStatement & { failed: boolean }> = [];
    const tracer: QueryTracer = {
      async query(statement, run) {
        try {
          const result = await run();
          seen.push({ ...statement, failed: false });
          return result;
        } catch (error) {
          seen.push({ ...statement, failed: true });
          throw error;
        }
      },
    };
    const database = await createDatabase({ filename: ':memory:', tracer });
    try {
      await database.transaction(async () => {
        await sql`create table t (id integer primary key, name text)`.execute(database.db());
        await database
          .db<{ t: { id: number; name: string } }>()
          .insertInto('t')
          .values({ id: 1, name: 'a' })
          .execute();
      });
      const rows = await database
        .db<{ t: { id: number; name: string } }>()
        .selectFrom('t')
        .selectAll()
        .execute();
      expect(rows).toEqual([{ id: 1, name: 'a' }]);
      await expect(sql`select * from missing`.execute(database.db())).rejects.toThrow();

      expect(seen.map((s) => [s.operation, s.failed])).toEqual([
        ['begin', false],
        ['create', false],
        ['insert', false],
        ['commit', false],
        ['select', false],
        ['select', true],
      ]);
      expect(seen[2]).toMatchObject({ dialect: 'sqlite', sql: expect.stringContaining('insert into "t"') });
      // Values stay out of the traced text.
      expect(seen[2]!.sql).not.toContain("'a'");
    } finally {
      await database.close();
    }
  });

  it('names the operation', () => {
    expect(sqlOperation('  SELECT 1')).toBe('select');
    expect(sqlOperation('/* x */ with a as (select 1) select * from a')).toBe('with');
    expect(sqlOperation('')).toBe('query');
  });
});
