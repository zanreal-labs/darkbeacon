import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  ConnectionDto,
  CreatedApiKeyDto,
  MapDto,
  MapShareDto,
  MapSnapshot,
  MeDto,
  PublicLinkDto,
  PublicMapViewDto,
  SignatureDto,
  StreamSnapshotDto,
} from '@darkbeacon/shared';
import { createApp } from '../app.js';
import { parseEnv } from '../config/config.js';
import { Browser } from '../test-support/browser.js';

const C2 = 31000399; // J130256
const C5 = 31001924; // J130026
const C1 = 31000220; // J121158
const NOTE = 'SECRET-NOTE-corp-a-staging';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

interface Client {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

/** Loaded at run time; see mcp.e2e.test.ts for why its types are not imported. */
const CLIENT_PACKAGE: string = '@modelcontextprotocol/client';
const { Client, StreamableHTTPClientTransport } = (await import(CLIENT_PACKAGE)) as {
  Client: new (info: { name: string; version: string }) => Client;
  StreamableHTTPClientTransport: new (url: URL, options?: unknown) => unknown;
};
const textOf = (result: unknown) => (result as ToolResult).content.map((c) => c.text ?? '').join('\n');

/**
 * External access to a composite map: its public link and agents see the merged chain cut by the
 * shares' scopes and then by the link's, and keys write through to the maps it merges.
 */
describeEachDialect('external access on a composite map', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    const config = {
      ...parseEnv({ NODE_ENV: 'test', PUBLIC_URL: 'http://dbk.test', DEMO_MODE: 'true' }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.close().catch(() => {});
    await app.close();
  });

  const signIn = async (name: string) => {
    const browser = new Browser(base);
    await browser.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name, character: { name: `${name} Main` } },
    });
    return browser;
  };

  const withKey = (token: string, path: string, method = 'GET', json?: unknown) =>
    fetch(`http://${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });

  const connect = async (token?: string) => {
    const client = new Client({ name: 'darkbeacon-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://${base}/mcp`), {
        ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}),
      }),
    );
    clients.push(client);
    return client;
  };

  const snapshotOf = async (browser: Browser, mapId: string) =>
    (await browser.json<StreamSnapshotDto>(`/api/streams/${encodeURIComponent(`map:${mapId}`)}/snapshot`))
      .data as MapSnapshot;

  /** Corp A (read-write: C2 - C5) and Corp B (read-only: C5 - C1) merged into Carol's composite. */
  const setup = async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    const carol = await signIn('carol');

    const corpA = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Corp A' } });
    for (const id of [C2, C5])
      await alice.json(`/api/maps/${corpA.id}/systems`, { method: 'POST', json: { solarSystemId: id } });
    await alice.json(`/api/maps/${corpA.id}/systems/${C2}`, {
      method: 'PATCH',
      json: { description: NOTE, status: 'hostile' },
    });
    const hole = await alice.json<ConnectionDto>(`/api/maps/${corpA.id}/connections`, {
      method: 'POST',
      json: { source: C2, target: C5 },
    });
    await alice.json(`/api/maps/${corpA.id}/connections/${hole.id}`, {
      method: 'PATCH',
      json: { massStatus: 'critical' },
    });

    const corpB = await bob.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Corp B' } });
    for (const id of [C5, C1])
      await bob.json(`/api/maps/${corpB.id}/systems`, { method: 'POST', json: { solarSystemId: id } });
    await bob.json(`/api/maps/${corpB.id}/connections`, { method: 'POST', json: { source: C5, target: C1 } });

    const alliance = await carol.json<MapDto>('/api/maps', {
      method: 'POST',
      json: { name: 'Alliance chain', kind: 'composite' },
    });
    for (const [owner, map, level] of [
      [alice, corpA, 'read-write'],
      [bob, corpB, 'read'],
    ] as const) {
      const offer = await owner.json<MapShareDto>(`/api/maps/${map.id}/shares`, {
        method: 'POST',
        json: { targetSlug: alliance.slug, level },
      });
      await carol.json(`/api/maps/${alliance.id}/shares/${offer.id}/accept`, { method: 'POST', json: {} });
    }
    await vi.waitFor(async () =>
      expect((await snapshotOf(carol, alliance.id)).systems!.map((s) => s.solarSystemId).sort()).toEqual(
        [C2, C5, C1].sort(),
      ),
    );
    return { alice, bob, carol, corpA, corpB, alliance };
  };

  it('publishes the merged chain, cut by the shares and then by the link', async () => {
    const { carol, alliance } = await setup();
    const link = await carol.json<PublicLinkDto>(`/api/maps/${alliance.id}/public-link`, {
      method: 'PATCH',
      json: { enabled: true },
    });
    const read = async () => {
      const response = await fetch(`http://${base}/api/public/maps/${link.token}`);
      expect(response.status).toBe(200);
      return response.text();
    };
    const body = await read();
    const view = JSON.parse(body) as PublicMapViewDto;
    expect(view.snapshot.systems.map((s) => s.solarSystemId).sort()).toEqual([C2, C5, C1].sort());
    expect(view.snapshot.connections).toHaveLength(2);
    expect(view.snapshot.connections).toContainEqual(expect.objectContaining({ massStatus: 'critical' }));
    // Which map an object came from, and the sources themselves, stay with the composite.
    expect(body).not.toContain('Corp A');
    expect(body).not.toContain('Corp B');
    expect(body).not.toContain('provenance');
    expect(body).not.toContain(NOTE);

    // The link may share intel, but the shares never gave the composite any: nothing more leaves.
    await carol.json(`/api/maps/${alliance.id}/public-link`, {
      method: 'PATCH',
      json: { scopes: ['intel', 'signatures'] },
    });
    const wider = await read();
    expect(wider).not.toContain(NOTE);
    expect(wider).not.toContain('hostile');
  });

  it('lets keys and agents write through to the merged maps, within the shares', async () => {
    const { alice, carol, corpA, alliance } = await setup();
    await alice.json('/api/admin/settings', { method: 'PATCH', json: { mcpMode: 'public' } });
    const merged = await snapshotOf(carol, alliance.id);
    const writable = merged.connections!.find((c) => [c.source, c.target].includes(C2))!;
    const readOnly = merged.connections!.find((c) => [c.source, c.target].includes(C1))!;

    const { token } = await carol.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { name: 'Bot', scopes: [`map:${alliance.id}:*`], readOnly: false, allowedIps: [] },
    });
    const path = (c: ConnectionDto) => `/api/maps/${alliance.id}/connections/${encodeURIComponent(c.id)}`;

    // Through the composite to Corp A, which shares read-write.
    expect((await withKey(token, path(writable), 'PATCH', { massStatus: 'reduced' })).status).toBe(200);
    await vi.waitFor(async () =>
      expect((await snapshotOf(alice, corpA.id)).connections).toContainEqual(
        expect.objectContaining({ massStatus: 'reduced' }),
      ),
    );
    // Corp B shares read-only, so the composite cannot change what only it holds.
    expect((await withKey(token, path(readOnly), 'PATCH', { massStatus: 'reduced' })).status).toBe(403);
    // Nor can anyone write what the share does not show (intel).
    expect(
      (await withKey(token, `/api/maps/${alliance.id}/systems/${C2}`, 'PATCH', { status: 'friendly' }))
        .status,
    ).toBe(403);
    // A read-only key reads the composite and writes nothing.
    const viewer = await carol.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { name: 'Viewer', scopes: [`map:${alliance.id}:*`], readOnly: true, allowedIps: [] },
    });
    expect((await withKey(viewer.token, `/api/maps/${alliance.id}`)).status).toBe(200);
    expect((await withKey(viewer.token, path(writable), 'PATCH', { massStatus: 'critical' })).status).toBe(
      403,
    );

    // An agent with the key does the same over MCP.
    const agent = await connect(token);
    const summary = textOf(await agent.callTool({ name: 'get_map', arguments: { map: alliance.id } }));
    expect(summary).toContain('J130256');
    expect(summary).toContain('J121158');
    // Merged ids are given whole (their ends repeat), and a short id that fits several is refused.
    expect(summary).toContain(`id ${writable.id}`);
    const ambiguous = await agent.callTool({
      name: 'update_connection',
      arguments: { map: alliance.id, connection: String(C5), massStatus: 'critical' },
    });
    expect(textOf(ambiguous)).toMatch(/give the whole id/);
    const updated = await agent.callTool({
      name: 'update_connection',
      arguments: { map: alliance.id, connection: writable.id, massStatus: 'critical' },
    });
    expect((updated as ToolResult).isError, textOf(updated)).toBeFalsy();
    const added = await agent.callTool({
      name: 'add_signature',
      arguments: { map: alliance.id, system: 'J130256', eveId: 'XYZ-789', group: 'wormhole' },
    });
    expect((added as ToolResult).isError, textOf(added)).toBeFalsy();
    await vi.waitFor(async () => {
      expect((await snapshotOf(alice, corpA.id)).connections).toContainEqual(
        expect.objectContaining({ massStatus: 'critical' }),
      );
      const sigs = await alice.json<SignatureDto[]>(`/api/maps/${corpA.id}/systems/${C2}/signatures`);
      expect(sigs.map((s) => s.eveId)).toContain('XYZ-789');
    });
    const refused = await agent.callTool({
      name: 'update_connection',
      arguments: { map: alliance.id, connection: readOnly.id, massStatus: 'critical' },
    });
    expect((refused as ToolResult).isError).toBe(true);

    // Anonymous agents read the composite's public projection only.
    await carol.json(`/api/maps/${alliance.id}/public-link`, {
      method: 'PATCH',
      json: { enabled: true, slug: 'alliance-public', mcpMode: 'public' },
    });
    const anonymous = await connect();
    const open = textOf(await anonymous.callTool({ name: 'get_map', arguments: { map: 'alliance-public' } }));
    expect(open).toContain('J130256');
    expect(open).not.toContain(NOTE);
    expect(open).not.toContain('Corp A');
  });
});
