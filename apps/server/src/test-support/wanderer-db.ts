import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const testdata = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '../adapters/importing/testdata', name), 'utf8');

/**
 * A Wanderer database on TEST_DATABASE_URL: our fork's tables (testdata/wanderer-schema.sql)
 * holding testdata/wanderer-map.sql, in a throwaway `t_` schema. It is dropped with the other test
 * schemas after the run (dropping one while another worker introspects the catalog fails that
 * worker). Returns the connection string that reads it.
 */
export async function createWandererDatabase(url: string): Promise<string> {
  const schema = `t_wanderer_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`create schema "${schema}"`);
    await client.query(`set search_path to "${schema}"`);
    await client.query(testdata('wanderer-schema.sql'));
    await client.query(testdata('wanderer-map.sql'));
  } finally {
    await client.end();
  }
  const connectionString = new URL(url);
  connectionString.searchParams.set('options', `-c search_path=${schema}`);
  return connectionString.toString();
}
