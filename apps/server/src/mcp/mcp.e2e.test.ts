import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditPageDto,
  ConnectionDto,
  CreatedApiKeyDto,
  MapDto,
  PublicLinkDto,
  MeDto,
} from '@darkbeacon/shared';
import { createApp } from '../app.js';
import { parseEnv } from '../config/config.js';
import { Browser } from '../test-support/browser.js';

const JITA = 30000142;
const PERIMETER = 30000144;
const NOTE = 'SECRET-NOTE-cyno-up';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

/** The parts of the SDK client the tests use. */
interface Client {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

/**
 * The official SDK client, loaded at run time: its package exports a `source` condition pointing
 * at TypeScript files that do not compile under this repository's settings (`tsc -b` resolves
 * that condition for the workspace packages), so its types are not imported.
 */
const CLIENT_PACKAGE: string = '@modelcontextprotocol/client';
const sdk = (await import(CLIENT_PACKAGE)) as {
  Client: new (info: { name: string; version: string }, options?: unknown) => Client;
  StreamableHTTPClientTransport: new (url: URL, options?: unknown) => unknown;
};
const { Client, StreamableHTTPClientTransport } = sdk;
const textOf = (result: unknown) => (result as ToolResult).content.map((c) => c.text ?? '').join('\n');

describeEachDialect('MCP endpoint', (t) => {
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

  const connect = async (token?: string, modern = false) => {
    const client = new Client(
      { name: 'darkbeacon-test', version: '1.0.0' },
      modern ? { versionNegotiation: { mode: 'auto' } } : {},
    );
    const transport = new StreamableHTTPClientTransport(new URL(`http://${base}/mcp`), {
      ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}),
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  const setup = async () => {
    const alice = await signIn('alice');
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Home chain' } });
    const secret = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Secret chain' } });
    const m = `/api/maps/${map.id}`;
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: JITA } });
    await alice.json(`${m}/systems`, { method: 'POST', json: { solarSystemId: PERIMETER } });
    await alice.json(`${m}/systems/${JITA}`, {
      method: 'PATCH',
      json: { description: NOTE, status: 'home' },
    });
    const connection = await alice.json<ConnectionDto>(`${m}/connections`, {
      method: 'POST',
      json: { source: JITA, target: PERIMETER, type: 'wormhole' },
    });
    return { alice, map, secret, m, connection };
  };

  it('is off until an admin chooses a mode, then needs a key', async () => {
    const { alice } = await setup();
    expect((await fetch(`http://${base}/mcp`, { method: 'POST' })).status).toBe(404);
    await alice.json('/api/admin/settings', { method: 'PATCH', json: { mcpMode: 'authenticated' } });
    const anonymous = await fetch(`http://${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(anonymous.status, await anonymous.clone().text()).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toMatch(/^Bearer /);
    // A browser page of another site may not call it.
    const foreign = await fetch(`http://${base}/mcp`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(foreign.status).toBe(403);
  });

  it('runs tools as the key, within its scopes, and records writes as made through MCP', async () => {
    const { alice, map, m, connection } = await setup();
    await alice.json('/api/admin/settings', { method: 'PATCH', json: { mcpMode: 'authenticated' } });
    const { token, key } = await alice.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { name: 'Claude', scopes: [`map:${map.id}:*`, 'universe:read'], readOnly: false, allowedIps: [] },
    });

    for (const modern of [false, true]) {
      const client = await connect(token, modern);
      const tools = (await client.listTools()).tools.map((x) => x.name);
      expect(tools).toEqual(
        expect.arrayContaining([
          'list_maps',
          'get_map',
          'find_route',
          'add_signature',
          'update_connection',
          'get_recent_history',
        ]),
      );

      const maps = textOf(await client.callTool({ name: 'list_maps', arguments: {} }));
      expect(maps).toContain('Home chain');
      expect(maps).not.toContain('Secret chain');

      const summary = textOf(await client.callTool({ name: 'get_map', arguments: { map: map.id } }));
      expect(summary).toContain('Jita');
      expect(summary).toContain('Perimeter');
      expect(summary).toContain(NOTE);

      const route = textOf(
        await client.callTool({
          name: 'find_route',
          arguments: { map: map.id, from: 'Perimeter', to: 'Jita' },
        }),
      );
      expect(route).toMatch(/^1 jumps/);
    }

    const client = await connect(token);
    const added = await client.callTool({
      name: 'add_signature',
      arguments: { map: map.id, system: 'Jita', eveId: 'ABC-123', group: 'wormhole' },
    });
    expect((added as ToolResult).isError).toBeFalsy();
    const updated = await client.callTool({
      name: 'update_connection',
      arguments: { map: map.id, connection: connection.id.slice(-8), massStatus: 'reduced' },
    });
    expect(textOf(updated)).toContain('mass reduced');

    const history = await alice.json<AuditPageDto>(`${m}/history`);
    const viaMcp = history.entries.filter((e) => e.channel.kind === 'mcp');
    expect(viaMcp.map((e) => e.type).sort()).toEqual(['connection.updated', 'signature.added']);
    expect(viaMcp[0]!.channel).toEqual({ kind: 'mcp', id: key.id, name: 'Claude' });

    const recent = textOf(
      await client.callTool({ name: 'get_recent_history', arguments: { map: map.id, limit: 5 } }),
    );
    expect(recent).toContain('via mcp (Claude)');
  });

  it('refuses what the scopes do not cover and hides writes from read-only keys', async () => {
    const { alice, map, secret } = await setup();
    await alice.json('/api/admin/settings', { method: 'PATCH', json: { mcpMode: 'authenticated' } });
    const narrow = await alice.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: {
        name: 'narrow',
        scopes: [`map:${map.id}:maps:read`, `map:${map.id}:signatures:write`],
        allowedIps: [],
      },
    });
    const client = await connect(narrow.token);
    const denied = await client.callTool({
      name: 'update_connection',
      arguments: { map: map.id, connection: 'whatever', massStatus: 'reduced' },
    });
    expect((denied as ToolResult).isError).toBe(true);
    expect(textOf(denied)).toMatch(/lacks the scope connections:write/);
    const other = await client.callTool({ name: 'get_map', arguments: { map: secret.id } });
    expect((other as ToolResult).isError).toBe(true);
    // Without systems:read what people wrote about systems stays out of the summary.
    const shape = textOf(await client.callTool({ name: 'get_map', arguments: { map: map.id } }));
    expect(shape).not.toContain(NOTE);
    expect(shape).not.toContain('status home');

    const ro = await alice.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { name: 'ro', scopes: ['*:*'], readOnly: true, allowedIps: [] },
    });
    const tools = (await (await connect(ro.token)).listTools()).tools.map((x) => x.name);
    expect(tools).not.toContain('add_signature');
    expect(tools).not.toContain('add_note');

    // A key that only writes signatures can do that, and nothing else.
    const signer = await alice.json<CreatedApiKeyDto>('/api/accounts/me/api-keys', {
      method: 'POST',
      json: { name: 'signer', scopes: [`map:${map.id}:signatures:write`], allowedIps: [] },
    });
    const signing = await connect(signer.token);
    const signed = await signing.callTool({
      name: 'add_signature',
      arguments: { map: map.id, system: 'Jita', eveId: 'SIG-001' },
    });
    expect((signed as ToolResult).isError).toBeFalsy();
    expect(textOf(await signing.callTool({ name: 'get_map', arguments: { map: map.id } }))).toMatch(
      /lacks the scope maps:read/,
    );

    // A map closed to agents is invisible to every key.
    await alice.json(`/api/maps/${map.id}/public-link`, { method: 'PATCH', json: { mcpMode: 'off' } });
    const closed = await client.callTool({ name: 'get_map', arguments: { map: map.id } });
    expect(textOf(closed)).toMatch(/closed to AI agents/);
  });

  it('lets anonymous agents read only public maps opened to them, never write', async () => {
    const { alice, map } = await setup();
    await alice.json('/api/admin/settings', { method: 'PATCH', json: { mcpMode: 'public' } });
    const share = await alice.json<PublicLinkDto>(`/api/maps/${map.id}/public-link`, {
      method: 'PATCH',
      json: { enabled: true, slug: 'home-public' },
    });
    const anonymous = await connect();
    // Public, but not opened to agents yet.
    expect(textOf(await anonymous.callTool({ name: 'list_maps', arguments: {} }))).toContain(
      'No public maps',
    );

    await alice.json(`/api/maps/${map.id}/public-link`, { method: 'PATCH', json: { mcpMode: 'public' } });
    const listed = textOf(await anonymous.callTool({ name: 'list_maps', arguments: {} }));
    expect(listed).toContain('Home chain');
    expect(listed).toContain('home-public');
    expect(listed).not.toContain('Secret chain');

    const tools = (await anonymous.listTools()).tools.map((x) => x.name);
    expect(tools).not.toEqual(expect.arrayContaining(['add_signature']));
    expect(tools).not.toContain('get_recent_history');
    for (const tool of (await anonymous.listTools()).tools)
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);

    const summary = textOf(await anonymous.callTool({ name: 'get_map', arguments: { map: 'home-public' } }));
    expect(summary).toContain('Jita');
    expect(summary).not.toContain(NOTE);
    expect(summary).not.toContain('status home');
    const byId = await anonymous.callTool({ name: 'get_map', arguments: { map: map.id } });
    expect((byId as ToolResult).isError).toBe(true);
    const sigs = await anonymous.callTool({
      name: 'list_signatures',
      arguments: { map: share.token!, system: 'Jita' },
    });
    expect(textOf(sigs)).toMatch(/does not share signatures/);
    // Write tools do not exist for anonymous agents.
    await expect(
      anonymous.callTool({ name: 'add_note', arguments: { map: 'home-public', system: 'Jita', note: 'x' } }),
    ).rejects.toThrow(/not found/);
  });
});
