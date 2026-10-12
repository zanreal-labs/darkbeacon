import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterEach, beforeEach, describe } from 'vitest';
import { createDatabase, type Database, type Dialect } from './database.js';

/**
 * Dialects to test, from TEST_DIALECTS (default `sqlite,postgres`). Postgres needs
 * TEST_DATABASE_URL; without it Postgres is skipped unless TEST_DIALECTS asks for it explicitly.
 */
export function testDialects(): Dialect[] {
  const explicit = process.env.TEST_DIALECTS;
  const requested = (explicit ?? 'sqlite,postgres').split(',').map((d) => d.trim());
  const dialects: Dialect[] = [];
  for (const d of requested) {
    if (d === 'sqlite') dialects.push('sqlite');
    else if (d === 'postgres') {
      if (process.env.TEST_DATABASE_URL) dialects.push('postgres');
      else if (explicit) throw new Error('TEST_DIALECTS includes postgres but TEST_DATABASE_URL is not set');
    } else if (d) throw new Error(`unknown dialect in TEST_DIALECTS: ${d}`);
  }
  return dialects;
}

export interface TestDatabase {
  db: Database;
  dispose(): Promise<void>;
}

/**
 * A fresh, migrated database: a SQLite file in a temporary directory (as in production: a write
 * and read connections), or a throwaway schema on TEST_DATABASE_URL.
 */
export async function createTestDatabase(dialect: Dialect): Promise<TestDatabase> {
  if (dialect === 'sqlite') {
    const dir = mkdtempSync(join(tmpdir(), 'dbk-test-'));
    const db = await createDatabase({ filename: join(dir, 'app.db') });
    await db.migrate();
    return {
      db,
      dispose: async () => {
        await db.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const schema = `${TEST_SCHEMA_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const db = await createDatabase({ url, schema, poolSize: 4 });
  await db.migrate();
  // Schemas are dropped by `dropTestSchemas` after the run: dropping one while another worker
  // introspects the catalog makes that worker fail.
  return { db, dispose: () => db.close() };
}

const TEST_SCHEMA_PREFIX = 't_';

/** Drops every test schema. Run from a vitest globalSetup before and after the whole run. */
export async function dropTestSchemas(url = process.env.TEST_DATABASE_URL): Promise<void> {
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ nspname: string }>(
      `select nspname from pg_namespace where nspname like '${TEST_SCHEMA_PREFIX}%'`,
    );
    for (const { nspname } of rows) await client.query(`drop schema if exists "${nspname}" cascade`);
  } finally {
    await client.end();
  }
}

export interface DbTestContext {
  readonly dialect: Dialect;
  /** A fresh migrated database per test. */
  readonly db: Database;
}

/**
 * Registers the suite once per dialect, each test getting its own migrated database:
 *
 *   describeEachDialect('KyselyMapRepository', (t) => {
 *     it('saves', async () => { const repo = new KyselyMapRepository(t.db); ... });
 *   });
 */
export function describeEachDialect(name: string, suite: (ctx: DbTestContext) => void): void {
  for (const dialect of testDialects()) {
    describe(`${name} [${dialect}]`, () => {
      let current: TestDatabase | undefined;
      const ctx: DbTestContext = {
        dialect,
        get db() {
          if (!current) throw new Error('database is only available inside a test');
          return current.db;
        },
      };
      beforeEach(async () => {
        current = await createTestDatabase(dialect);
      });
      afterEach(async () => {
        await current?.dispose();
        current = undefined;
      });
      suite(ctx);
    });
  }
}
