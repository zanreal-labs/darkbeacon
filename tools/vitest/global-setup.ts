import { dropTestSchemas } from '@darkbeacon/db/testing';

// Removes Postgres test schemas left by this or an earlier run.
export async function setup(): Promise<void> {
  await dropTestSchemas();
}

export async function teardown(): Promise<void> {
  await dropTestSchemas();
}
