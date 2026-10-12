import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditPageDto,
  CommentDto,
  MapDto,
  RemovedSignaturesDto,
  SignatureDto,
  StructureDto,
} from '@darkbeacon/shared';
import { SYSTEMS } from '../../adapters/mapping/testing.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { ActorResolverRegistry } from '../../platform/actor.js';

function dataDirWithUniverse(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbk-intel-'));
  const system = (id: number, name: string, whClass: number) => ({
    id,
    name,
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
      systems: [system(SYSTEMS.c2, 'J100101', 2), system(SYSTEMS.c5, 'J100104', 5)],
    }),
  );
  return dir;
}

describeEachDialect('signatures, comments and structures over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;

  const call = async <T = unknown>(method: string, path: string, user: string | null, body?: unknown) => {
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

  it('links, removes several with an undo, comments, structures and reverts from the history', async () => {
    const map = (await call<MapDto>('POST', '/api/maps', 'alice', { name: 'Chain' })).body;
    const m = `/api/maps/${map.id}`;
    for (const id of [SYSTEMS.c2, SYSTEMS.c5])
      await call('POST', `${m}/systems`, 'alice', { solarSystemId: id });
    const hole = (
      await call<{ id: string }>('POST', `${m}/connections`, 'alice', {
        source: SYSTEMS.c2,
        target: SYSTEMS.c5,
      })
    ).body;

    const sig = (
      await call<SignatureDto>('POST', `${m}/systems/${SYSTEMS.c2}/signatures`, 'alice', {
        eveId: 'ABC-123',
        type: 'H296',
        tempName: 'Five',
        bubbled: true,
      })
    ).body;
    expect(sig).toMatchObject({ tempName: 'Five', bubbled: true, createdBy: { accountId: 'alice' } });
    const linked = await call<SignatureDto>('PATCH', `${m}/signatures/${sig.id}`, 'alice', {
      connectionId: hole.id,
    });
    expect(linked).toMatchObject({ status: 200, body: { connectionId: hole.id, group: 'wormhole' } });

    const removed = await call<RemovedSignaturesDto>(
      'POST',
      `${m}/systems/${SYSTEMS.c2}/signatures/remove`,
      'alice',
      { ids: [sig.id], withConnections: true },
    );
    expect(removed).toMatchObject({ status: 200, body: { connectionIds: [hole.id] } });
    const restored = await call<SignatureDto[]>('POST', `${m}/signatures/restore`, 'alice', {
      signatures: removed.body.signatures,
    });
    expect(restored).toMatchObject({
      status: 200,
      body: [{ id: sig.id, tempName: 'Five', connectionId: null }],
    });

    const comment = await call<CommentDto>('POST', `${m}/systems/${SYSTEMS.c2}/comments`, 'alice', {
      text: 'Keepstar **here**',
    });
    expect(comment.status).toBe(201);
    expect(
      (await call('POST', `${m}/systems/${SYSTEMS.c2}/comments`, 'alice', { text: 'x'.repeat(501) })).status,
    ).toBe(400);
    expect((await call('DELETE', `${m}/comments/${comment.body.id}`, 'alice')).status).toBe(204);

    const pasted = await call('POST', `${m}/systems/${SYSTEMS.c2}/structures/paste`, 'alice', {
      text: '35832\tJ100101 - Home\tAstrahus\t1 km',
    });
    expect(pasted).toMatchObject({ status: 200, body: { added: 1 } });
    const [structure] = (await call<StructureDto[]>('GET', `${m}/systems/${SYSTEMS.c2}/structures`, 'alice'))
      .body;
    expect(structure).toMatchObject({ name: 'Home', status: 'powered' });
    expect(
      (
        await call('PATCH', `${m}/structures/${structure!.id}`, 'alice', {
          status: 'reinforced',
          endsAt: 5_000,
        })
      ).status,
    ).toBe(200);
    expect((await call<StructureDto[]>('GET', `${m}/structures`, 'alice')).body).toHaveLength(1);

    // The system's history has them, and the comment removal can be put back.
    const history = (await call<AuditPageDto>('GET', `${m}/systems/${SYSTEMS.c2}/history`, 'alice')).body;
    const types = history.entries.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['comment.added', 'comment.removed', 'structure.updated']));
    const removal = history.entries.find((e) => e.type === 'comment.removed')!;
    expect(removal.revertible).toBe(true);
    expect((await call('POST', `${m}/history/${removal.id}/revert`, 'alice')).status).toBe(200);
    const thread = (await call<CommentDto[]>('GET', `${m}/systems/${SYSTEMS.c2}/comments`, 'alice')).body;
    expect(thread.map((c) => c.text)).toEqual(['Keepstar **here**']);
    const update = history.entries.find((e) => e.type === 'structure.updated')!;
    expect((await call('POST', `${m}/history/${update.id}/revert`, 'alice')).status).toBe(200);
    expect((await call<StructureDto[]>('GET', `${m}/structures`, 'alice')).body[0]).toMatchObject({
      status: 'powered',
      endsAt: null,
    });
  });
});
