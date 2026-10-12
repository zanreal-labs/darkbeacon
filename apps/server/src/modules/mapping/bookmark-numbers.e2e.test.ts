import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type { AuditPageDto, ConnectionDto, MapDto, MapPreferencesDto } from '@darkbeacon/shared';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';

// A C2 home and three holes out of it.
const HOME = SYSTEMS.c2;
const HOLES = [SYSTEMS.c1, SYSTEMS.shattered, SYSTEMS.c5];

/** universe.json in the data directory with the four systems. */
function dataDirWithUniverse(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbk-numbers-'));
  const system = (id: number, whClass: number) => ({
    id,
    name: `J${id}`,
    regionId: 1,
    constellationId: 2,
    security: -1,
    whClass,
    gates: [],
  });
  writeFileSync(
    join(dir, 'universe.json'),
    JSON.stringify({
      source: 'test',
      regions: [{ id: 1, name: 'A-R00001' }],
      constellations: [{ id: 2, name: 'A-C00001', regionId: 1 }],
      systems: [system(HOME, 2), system(HOLES[0]!, 1), system(HOLES[1]!, 13), system(HOLES[2]!, 5)],
    }),
  );
  return dir;
}

describeEachDialect('bookmark numbers over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  const call = async (method: string, path: string, user: string | null, body?: unknown) => {
    const response = await fetch(`http://${base}${path}`, {
      method,
      headers: {
        ...(user ? { 'x-test-actor': user } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test' }),
      secretKey: 'x'.repeat(32),
      dataDir: dataDirWithUniverse(),
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

  it('numbers wormholes for everyone, keeps them stable and lets the map choose the order', async () => {
    const map = (await call('POST', '/api/maps', 'alice', { name: 'Chain' })).body as MapDto;
    const m = `/api/maps/${map.id}`;
    for (const id of [HOME, ...HOLES]) await call('POST', `${m}/systems`, 'alice', { solarSystemId: id });
    await call('PATCH', `${m}/systems/${HOME}`, 'alice', { status: 'home' });
    const holes: ConnectionDto[] = [];
    for (const target of HOLES) {
      const added = await call('POST', `${m}/connections`, 'alice', { source: HOME, target });
      expect(added.status).toBe(201);
      holes.push(added.body as ConnectionDto);
    }
    expect(holes.map((c) => [c.bookmarkParent, c.bookmarkNumber])).toEqual([
      [HOME, 1],
      [HOME, 2],
      [HOME, 3],
    ]);

    // WH2 collapses: WH1 and WH3 stay.
    expect((await call('DELETE', `${m}/connections/${holes[1]!.id}`, 'alice')).status).toBe(204);
    const snapshot = async () =>
      (
        (await call('GET', `/api/streams/map:${map.id}/snapshot`, 'alice')).body as {
          data: { connections: ConnectionDto[] };
        }
      ).data.connections
        .map((c) => [c.target, c.bookmarkNumber])
        .sort((a, b) => a[0]! - b[0]!);
    expect(await snapshot()).toEqual([
      [HOLES[0], 1],
      [HOLES[2], 3],
    ]);

    // By hand: WH3 becomes WH1, the old WH1 takes 3.
    const moved = await call('PUT', `${m}/connections/${holes[2]!.id}/bookmark-number`, 'alice', {
      number: 1,
    });
    expect(moved).toMatchObject({ status: 200, body: { bookmarkNumber: 1 } });
    expect(await snapshot()).toEqual([
      [HOLES[0], 3],
      [HOLES[2], 1],
    ]);
    expect(
      (await call('PUT', `${m}/connections/${holes[2]!.id}/bookmark-number`, 'alice', { number: 0 })).status,
    ).toBe(400);

    // The audit trail has the change, field by field, and it can be reverted.
    const history = (await call('GET', `${m}/connections/${holes[2]!.id}/history`, 'alice'))
      .body as AuditPageDto;
    const change = history.entries.find((e) => e.type === 'connection.updated' && e.diff.bookmarkNumber);
    expect(change?.diff.bookmarkNumber).toEqual({ before: 3, after: 1 });
    expect((await call('POST', `${m}/history/${change!.id}/revert`, 'alice')).status).toBeLessThan(300);
    expect(await snapshot()).toEqual([
      [HOLES[0], 1],
      [HOLES[2], 3],
    ]);

    // Managers set the map's numbering; renumber on request closes the gap.
    const numbering = await call('PUT', `${m}/bookmark-numbering`, 'alice', {
      numbering: { order: 'found', renumberOnClose: true },
    });
    expect((numbering.body as MapDto).settings.bookmarkNumbering).toEqual({
      order: 'found',
      renumberOnClose: true,
    });
    expect(await snapshot()).toEqual([
      [HOLES[0], 1],
      [HOLES[2], 2],
    ]);
    expect(
      (await call('PUT', `${m}/bookmark-numbering`, 'alice', { numbering: { order: 'nope' } })).status,
    ).toBe(400);
    expect((await call('POST', `${m}/bookmark-numbers/renumber`, 'alice', {})).status).toBe(204);
    expect((await call('POST', `${m}/bookmark-numbers/renumber`, 'bob', {})).status).toBe(404);
    expect((await call('PUT', `${m}/bookmark-numbering`, 'bob', { numbering: null })).status).toBe(404);

    // A pilot's own order is a preference, private to them.
    const prefs = await call('PATCH', `${m}/preferences`, 'alice', { bookmarkOrder: 'signature' });
    expect((prefs.body as MapPreferencesDto).bookmarkOrder).toBe('signature');
    expect(((await call('GET', `${m}/preferences`, 'alice')).body as MapPreferencesDto).bookmarkOrder).toBe(
      'signature',
    );
    expect((await call('PATCH', `${m}/preferences`, 'alice', { bookmarkOrder: 'random' })).status).toBe(400);
  });
});
