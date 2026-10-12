import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InstanceRole } from '@darkbeacon/core';
import type { Database } from '@darkbeacon/db';
import { SYSTEMS } from '../adapters/mapping/testing.js';
import { createApp } from '../app.js';
import { parseEnv, type AppConfig } from '../config/config.js';
import { ActorResolverRegistry } from '../platform/actor.js';

/** A data directory with a small universe.json (the fixture J-systems and Jita). */
export function dataDirWithUniverse(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbk-e2e-'));
  const system = (id: number, name: string, whClass: number, gates: number[] = []) => ({
    id,
    name,
    regionId: 1,
    constellationId: 2,
    security: whClass >= 7 ? 0.9 : -1,
    whClass,
    gates,
  });
  writeFileSync(
    join(dir, 'universe.json'),
    JSON.stringify({
      source: 'test',
      regions: [{ id: 1, name: 'A-R00001' }],
      constellations: [{ id: 2, name: 'A-C00001', regionId: 1 }],
      systems: [
        system(SYSTEMS.c2, 'J100101', 2),
        system(SYSTEMS.c1, 'J100102', 1),
        system(SYSTEMS.c5, 'J100104', 5),
        system(SYSTEMS.jita, 'Jita', 7, [SYSTEMS.perimeter]),
        system(SYSTEMS.perimeter, 'Perimeter', 7, [SYSTEMS.jita]),
      ],
    }),
  );
  return dir;
}

export interface TestApp {
  app: NestFastifyApplication;
  base: string;
  /**
   * A JSON call as `user` (an account id; `admin:<id>` for an instance admin), or anonymous. The
   * body is parsed when it is JSON.
   */
  call(
    method: string,
    path: string,
    user: string | null,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: unknown; headers: Headers }>;
  close(): Promise<void>;
}

/**
 * The whole server on a random port, with a stand-in for sign-in: the `x-test-actor` header names
 * the account (`admin:alice` makes alice an instance admin).
 */
export async function startTestApp(
  database: Database,
  over: Partial<AppConfig> = {},
  env: Record<string, string> = {},
): Promise<TestApp> {
  const config = {
    ...parseEnv({ NODE_ENV: 'test', ...env }),
    secretKey: 'x'.repeat(32),
    dataDir: dataDirWithUniverse(),
    ...over,
  };
  const app = await createApp(config, { database, logger: false });
  const registry = app.get(ActorResolverRegistry);
  registry.use(async (req) => {
    const match = /^(?:(admin|owner):)?(\w+)$/.exec(String(req.headers['x-test-actor'] ?? ''));
    if (!match) return null;
    const instanceRole: InstanceRole = (match[1] as InstanceRole | undefined) ?? 'user';
    return { kind: 'account', id: match[2]!, instanceRole };
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  return {
    app,
    base,
    async call(method, path, user, body, headers = {}) {
      const response = await fetch(`http://${base}${path}`, {
        method,
        headers: {
          ...(user ? { 'x-test-actor': user } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        // not JSON
      }
      return { status: response.status, body: parsed, headers: response.headers };
    },
    close: () => app.close(),
  };
}
