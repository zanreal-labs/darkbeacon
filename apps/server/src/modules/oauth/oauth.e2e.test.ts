import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AuditPageDto,
  MapDto,
  MeDto,
  OAuthAuthorizeRequestDto,
  OAuthGrantDto,
  OAuthRedirectDto,
  OAuthRegisteredClientDto,
  OAuthTokenResponse,
} from '@darkbeacon/shared';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';

const JITA = 30000142;
const REDIRECT = 'http://127.0.0.1/callback';

describeEachDialect('OAuth for the MCP endpoint', (t) => {
  let app: NestFastifyApplication;
  let base: string;

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
    await app.close();
  });

  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };

  const form = (body: Record<string, string>) =>
    fetch(`http://${base}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

  /** A JSON-RPC call to /mcp as a 2026-07-28 client. */
  const mcp = (token: string | null, method: string, params: Record<string, unknown> = {}) =>
    fetch(`http://${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });

  it('lets a person approve an MCP client with PKCE, then the client acts for them on /mcp only', async () => {
    const alice = new Browser(base);
    await alice.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name: 'alice', character: { name: 'Alice' } },
    });
    await alice.json('/api/admin/settings', { method: 'PATCH', json: { mcpMode: 'authenticated' } });
    const map = await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    await alice.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Other' } });
    await alice.json(`/api/maps/${map.id}/systems`, { method: 'POST', json: { solarSystemId: JITA } });

    // Discovery: a 401 that points at the metadata, then the metadata documents.
    const challenge = await mcp(null, 'tools/list');
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://dbk.test/.well-known/oauth-protected-resource/mcp"',
    );
    const prm = (await (
      await fetch(`http://${base}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({
      resource: 'http://dbk.test/mcp',
      authorization_servers: ['http://dbk.test'],
    });
    const as = (await (
      await fetch(`http://${base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: 'http://dbk.test',
      authorization_endpoint: 'http://dbk.test/oauth/authorize',
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
    });

    // Dynamic registration, then the consent page's two calls.
    const client = (await (
      await fetch(`http://${base}/api/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test agent',
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: 'none',
        }),
      })
    ).json()) as OAuthRegisteredClientDto;
    expect(client.client_id).toMatch(/^dbk_client_/);
    const { verifier, challenge: codeChallenge } = pkce();
    const request = {
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:43123/callback',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'maps:read signatures:write admin:*',
      state: 'xyz',
      resource: 'http://dbk.test/mcp',
    };
    const described = await alice.json<OAuthAuthorizeRequestDto>(
      `/api/oauth/authorize?${new URLSearchParams(request)}`,
    );
    expect(described).toMatchObject({
      client: { name: 'Test agent', kind: 'registered' },
      redirectHost: '127.0.0.1:43123',
    });
    expect(described.scopes).toEqual(['maps:read', 'signatures:write']);
    // A redirect URI the client did not register is refused before anything is sent to it.
    const foreign = await alice.request(
      `/api/oauth/authorize?${new URLSearchParams({ ...request, redirect_uri: 'https://evil.example/cb' })}`,
    );
    expect(foreign.status).toBe(400);

    const { redirectTo } = await alice.json<OAuthRedirectDto>('/api/oauth/authorize', {
      method: 'POST',
      json: { ...request, approve: true, maps: [map.id], readOnly: false },
    });
    const back = new URL(redirectTo);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe('http://dbk.test');
    const code = back.searchParams.get('code')!;

    // The code needs the verifier, the same client and redirect URI, and works once.
    const exchange = {
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      redirect_uri: request.redirect_uri,
      resource: 'http://dbk.test/mcp',
    };
    expect((await form({ ...exchange, code_verifier: pkce().verifier })).status).toBe(400);
    // That failed attempt used the code up: get a fresh one.
    const second = await alice.json<OAuthRedirectDto>('/api/oauth/authorize', {
      method: 'POST',
      json: { ...request, approve: true, maps: [map.id], readOnly: false },
    });
    const code2 = new URL(second.redirectTo).searchParams.get('code')!;
    const tokenResponse = await form({ ...exchange, code: code2, code_verifier: verifier });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as OAuthTokenResponse;
    expect(tokens.access_token).toMatch(/^dbk_oat_/);
    expect(tokens.refresh_token).toMatch(/^dbk_ort_/);
    expect(tokens.scope).toBe(`map:${map.id}:maps:read map:${map.id}:signatures:write`);

    // The token works on /mcp as alice, narrowed to the approved map, and nowhere else.
    const listed = await mcp(tokens.access_token, 'tools/call', { name: 'list_maps', arguments: {} });
    const text = JSON.stringify(await listed.json());
    expect(text).toContain('Chain');
    expect(text).not.toContain('Other');
    const added = await mcp(tokens.access_token, 'tools/call', {
      name: 'add_signature',
      arguments: { map: map.id, system: 'Jita', eveId: 'OAU-123' },
    });
    expect(JSON.stringify(await added.json())).toContain('Added OAU-123');
    expect(
      (
        await fetch(`http://${base}/api/maps`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
    ).toBe(401);
    const history = await alice.json<AuditPageDto>(`/api/maps/${map.id}/history`);
    expect(history.entries.find((e) => e.type === 'signature.added')!.channel).toMatchObject({
      kind: 'mcp',
      name: 'Test agent',
    });

    // Refresh tokens rotate; using one twice ends the approval (so does replaying a code).
    const refreshed = (await (
      await form({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      })
    ).json()) as OAuthTokenResponse;
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(
      await (await form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).json(),
    ).toMatchObject({ error: 'invalid_grant' });
    expect((await mcp(refreshed.access_token, 'tools/list')).status).toBe(401);
    const replay = await form({ ...exchange, code: code2, code_verifier: verifier });
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });

    // Approvals are listed and revoked from the account.
    const third = await alice.json<OAuthRedirectDto>('/api/oauth/authorize', {
      method: 'POST',
      json: { ...request, approve: true, maps: null, readOnly: true },
    });
    const tokens3 = (await (
      await form({
        ...exchange,
        code: new URL(third.redirectTo).searchParams.get('code')!,
        code_verifier: verifier,
      })
    ).json()) as OAuthTokenResponse;
    expect((await mcp(tokens3.access_token, 'tools/list')).status).toBe(200);
    const grants = await alice.json<OAuthGrantDto[]>('/api/accounts/me/oauth-grants');
    const live = grants.find((g) => g.readOnly)!;
    expect(live).toMatchObject({ clientName: 'Test agent', scopes: ['maps:read', 'signatures:write'] });
    await alice.request(`/api/accounts/me/oauth-grants/${live.id}`, { method: 'DELETE' });
    expect((await mcp(tokens3.access_token, 'tools/list')).status).toBe(401);

    // Declining sends the person back with access_denied.
    const declined = await alice.json<OAuthRedirectDto>('/api/oauth/authorize', {
      method: 'POST',
      json: { ...request, approve: false },
    });
    expect(new URL(declined.redirectTo).searchParams.get('error')).toBe('access_denied');
  });
});
