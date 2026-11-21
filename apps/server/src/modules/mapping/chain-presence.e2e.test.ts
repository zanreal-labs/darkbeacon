import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { ChainPresenceListDto, ConnectionDto, MapDto } from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';
import { EventConsumers } from '../../platform/event-consumers.js';

const HOME = 31002531; // J014348
const HOLE = 31000399; // J130256

describeEachDialect('chain presence over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  const call = async <T>(method: string, path: string, user: string | null, body?: unknown) => {
    const response = await fetch(`http://${base}${path}`, {
      method,
      headers: {
        ...(user ? { 'x-test-actor': user } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test' }),
      secretKey: 'x'.repeat(32),
      dataDir: mkdtempSync(join(tmpdir(), 'dbk-presence-')),
    };
    app = await createApp(config, { database: t.db, logger: false });
    app.get(ActorResolverRegistry).use(async (req) => {
      const match = /^(\w+)$/.exec(String(req.headers['x-test-actor'] ?? ''));
      return match ? { kind: 'account', id: match[1]!, instanceRole: 'user' } : null;
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('records the chain as it changes and tells when a system was last in it', async () => {
    const map = (await call<MapDto>('POST', '/api/maps', 'alice', { name: 'Chain' })).body;
    const m = `/api/maps/${map.id}`;
    await call('POST', `${m}/systems`, 'alice', { solarSystemId: HOME });
    await call('PATCH', `${m}/systems/${HOME}`, 'alice', { status: 'home' });
    await call('POST', `${m}/systems`, 'alice', { solarSystemId: HOLE });
    const hole = (
      await call<ConnectionDto>('POST', `${m}/connections`, 'alice', { source: HOME, target: HOLE })
    ).body;

    const presence = async () => {
      await app.get(EventConsumers).wake();
      return (await call<ChainPresenceListDto>('GET', `${m}/chain-presence`, 'alice')).body;
    };
    await vi.waitFor(async () =>
      expect((await presence()).systems).toEqual([
        { solarSystemId: HOLE, joinedAt: expect.any(Number), leftAt: null, previousLeftAt: null },
        { solarSystemId: HOME, joinedAt: expect.any(Number), leftAt: null, previousLeftAt: null },
      ]),
    );

    // The hole closes: the system it led to was last in the chain then.
    await call('DELETE', `${m}/connections/${hole.id}`, 'alice');
    await vi.waitFor(async () => {
      const list = await presence();
      expect(list.systems.find((s) => s.solarSystemId === HOLE)?.leftAt).toEqual(expect.any(Number));
      expect(list.systems.find((s) => s.solarSystemId === HOME)?.leftAt).toBeNull();
      expect(list.recordedSince).toEqual(expect.any(Number));
    });

    // Somebody who may not see the map learns nothing.
    expect((await call('GET', `${m}/chain-presence`, 'mallory')).status).toBe(404);
  });
});
