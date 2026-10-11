import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@wormwright/db/testing';
import type {
  AccessRuleDto,
  AdminAccountDto,
  InstanceSettingsDto,
  MapDto,
  MeDto,
  ServerMessage,
} from '@wormwright/shared';
import WebSocket from 'ws';
import {
  DISCORD_CLIENT,
  EVE_CLIENT,
  FakeNetwork,
  type DiscordUser,
} from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';

/** A browser: keeps cookies per name and never follows redirects. */
class Browser {
  readonly cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const { json, ...rest } = init;
    const response = await fetch(`http://${this.base}${path}`, {
      redirect: 'manual',
      ...rest,
      headers: {
        cookie: this.cookieHeader,
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split('; ');
      const [name, value] = pair!.split('=') as [string, string];
      if (attributes.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async json<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const response = await this.request(path, init);
    expect(response.status, `${init.method ?? 'GET'} ${path}`).toBeLessThan(300);
    return (await response.json()) as T;
  }

  /** Follows an OAuth round trip: our redirect, the provider's approval, our callback. */
  async oauth(start: string, approve: (challenge: string | null) => string): Promise<string> {
    const begin = await this.request(start);
    expect(begin.status).toBe(302);
    const provider = new URL(begin.headers.get('location')!);
    const code = approve(provider.searchParams.get('code_challenge'));
    const redirectUri = new URL(provider.searchParams.get('redirect_uri')!);
    const callback = await this.request(
      `${redirectUri.pathname}?code=${code}&state=${provider.searchParams.get('state')}`,
    );
    expect(callback.status).toBe(302);
    return callback.headers.get('location')!;
  }
}

const discordUser = (id: string, name: string): DiscordUser => ({
  id,
  username: name,
  global_name: null,
  avatar: null,
});

describeEachDialect('identity and access over HTTP', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  let network: FakeNetwork;
  const browser = () => new Browser(base);

  beforeEach(async () => {
    network = new FakeNetwork();
    const config = {
      ...parseEnv({
        NODE_ENV: 'test',
        PUBLIC_URL: 'http://ww.test',
        DISCORD_CLIENT_ID: DISCORD_CLIENT.clientId,
        DISCORD_CLIENT_SECRET: DISCORD_CLIENT.clientSecret,
        EVE_CLIENT_ID: EVE_CLIENT.clientId,
        EVE_CLIENT_SECRET: EVE_CLIENT.clientSecret,
        DEV_LOGIN: 'true',
      }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, {
      database: t.db,
      logger: false,
      webDist: '/nonexistent',
      fetch: network.fetch,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists the configured sign-in providers', async () => {
    expect(await browser().json('/api/auth/providers')).toEqual({ discord: true, eve: true, dev: true });
  });

  it('signs in with Discord, links an EVE character and logs out', async () => {
    const alice = browser();
    const landed = await alice.oauth('/api/auth/discord/login?returnTo=/m/home', (challenge) =>
      network.approveDiscord(discordUser('1001', 'alice'), challenge),
    );
    expect(landed).toBe('/m/home');
    expect(alice.cookies.has('ww_session')).toBe(true);
    expect(alice.cookies.has('ww_oauth')).toBe(false);

    const me = await alice.json<MeDto>('/api/accounts/me');
    expect(me.account).toMatchObject({ discordId: '1001', name: 'alice', instanceRole: 'owner' });

    const pilot = {
      id: 2112000001,
      name: 'Alice Pilot',
      owner: 'h1',
      corporationId: 98000001,
      allianceId: 99000001,
    };
    expect(
      await alice.oauth('/api/auth/eve/login', (challenge) => network.approveEve(pilot, challenge)),
    ).toBe('/');
    const linked = await alice.json<MeDto>('/api/accounts/me');
    expect(linked.characters).toEqual([
      expect.objectContaining({
        id: pilot.id,
        name: 'Alice Pilot',
        corporationId: 98000001,
        allianceId: 99000001,
        tokenValid: true,
      }),
    ]);

    // Another account cannot take the character.
    const bob = browser();
    await bob.oauth('/api/auth/discord/login', (challenge) =>
      network.approveDiscord(discordUser('1002', 'bob'), challenge),
    );
    const refused = await bob.oauth('/api/auth/eve/login', (challenge) =>
      network.approveEve(pilot, challenge),
    );
    expect(new URL(refused, 'http://x').searchParams.get('auth_error')).toMatch(/already linked/);
    expect((await bob.json<MeDto>('/api/accounts/me')).account.instanceRole).toBe('user');

    // Only an own character can be the main one.
    const main = { method: 'PUT', json: { characterId: pilot.id } };
    expect((await bob.request('/api/accounts/me/main-character', main)).status).toBe(404);
    expect((await alice.json<MeDto>('/api/accounts/me/main-character', main)).account.mainCharacterId).toBe(
      pilot.id,
    );

    expect(
      (await alice.request(`/api/accounts/me/characters/${pilot.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect((await alice.json<MeDto>('/api/accounts/me')).characters).toEqual([]);
    expect((await alice.json<MeDto>('/api/accounts/me')).account.mainCharacterId).toBeNull();

    expect((await alice.request('/api/auth/logout', { method: 'POST' })).status).toBe(204);
    expect(alice.cookies.has('ww_session')).toBe(false);
    expect((await alice.request('/api/accounts/me')).status).toBe(401);
  });

  it('refuses a callback with a forged state or without the round-trip cookie', async () => {
    const mallory = browser();
    const begin = await mallory.request('/api/auth/discord/login');
    const state = new URL(begin.headers.get('location')!).searchParams.get('state');
    const code = network.approveDiscord(discordUser('1003', 'mallory'), null);

    const forged = await mallory.request(`/api/auth/discord/callback?code=${code}&state=forged`);
    expect(forged.headers.get('location')).toMatch(/^\/\?auth_error=/);
    // The round-trip cookie is single use.
    const replay = await mallory.request(`/api/auth/discord/callback?code=${code}&state=${state}`);
    expect(replay.headers.get('location')).toMatch(/auth_error=/);
    expect(mallory.cookies.has('ww_session')).toBe(false);

    const cancelled = await browser().request('/api/auth/discord/callback?error=access_denied');
    expect(cancelled.headers.get('location')).toMatch(/auth_error=Discord/);
    const anonymousEve = await browser().request('/api/auth/eve/login');
    expect(anonymousEve.headers.get('location')).toMatch(/auth_error=Sign/);
  });

  it('dev login, admin roles, settings and log out everywhere', async () => {
    const owner = browser();
    const me = await owner.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name: 'owner', character: { name: 'Owner Pilot' } },
    });
    expect(me.account.instanceRole).toBe('owner');
    expect(me.characters).toHaveLength(1);

    const bob = browser();
    const bobMe = await bob.json<MeDto>('/api/auth/dev', { method: 'POST', json: { name: 'bob' } });
    expect((await bob.request('/api/admin/accounts')).status).toBe(403);
    expect((await bob.request('/api/admin/settings')).status).toBe(403);

    const promoted = await owner.json<AdminAccountDto>(`/api/admin/accounts/${bobMe.account.id}/role`, {
      method: 'PUT',
      json: { role: 'admin' },
    });
    expect(promoted.instanceRole).toBe('admin');
    expect((await bob.json<AdminAccountDto[]>('/api/admin/accounts')).map((a) => a.name)).toEqual([
      'owner',
      'bob',
    ]);

    const settings = await bob.json<InstanceSettingsDto>('/api/admin/settings', {
      method: 'PATCH',
      json: { adminGuildId: '123', adminRoleIds: ['456'] },
    });
    expect(settings).toEqual({
      adminGuildId: '123',
      adminRoleIds: ['456'],
      webhooksToPrivateNetworks: false,
    });
    expect(
      (await bob.request('/api/admin/settings', { method: 'PATCH', json: { adminGuildId: 'x' } })).status,
    ).toBe(400);

    // Only the owner transfers ownership.
    const transfer = { method: 'POST', json: { accountId: bobMe.account.id } };
    expect((await bob.request('/api/admin/transfer-ownership', transfer)).status).toBe(403);
    expect((await owner.request('/api/admin/transfer-ownership', transfer)).status).toBe(204);
    expect((await bob.json<MeDto>('/api/accounts/me')).account.instanceRole).toBe('owner');
    expect((await owner.json<MeDto>('/api/accounts/me')).account.instanceRole).toBe('admin');

    const elsewhere = browser();
    await elsewhere.json('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
    expect((await owner.request('/api/auth/logout-everywhere', { method: 'POST' })).status).toBe(204);
    expect((await elsewhere.request('/api/accounts/me')).status).toBe(401);
    expect((await owner.request('/api/accounts/me')).status).toBe(401);
  });

  it('makes Discord guild roles grant instance admin', async () => {
    const owner = browser();
    await owner.json('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
    await owner.json('/api/admin/settings', {
      method: 'PATCH',
      json: { adminGuildId: '500', adminRoleIds: ['501'] },
    });

    network.guildRoles.set('2001|500', ['501']);
    const carol = browser();
    await carol.oauth('/api/auth/discord/login', (challenge) =>
      network.approveDiscord(discordUser('2001', 'carol'), challenge),
    );
    expect((await carol.json<MeDto>('/api/accounts/me')).account.instanceRole).toBe('admin');
    expect(network.calls).toContain('GET https://discord.com/api/v10/users/@me/guilds/500/member');
  });

  it('authorizes maps through access rules, over REST and the map stream', async () => {
    const owner = browser();
    await owner.json<MeDto>('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
    const pilot = browser();
    const pilotMe = await pilot.json<MeDto>('/api/auth/dev', {
      method: 'POST',
      json: { name: 'pilot', character: { name: 'Corp Pilot', corporationId: 98000077 } },
    });
    const { id: mapId } = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });

    expect((await pilot.request(`/api/maps/${mapId}/access-rules`)).status).toBe(404);
    const rule = await owner.json<AccessRuleDto>(`/api/maps/${mapId}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'corporation', subjectId: '98000077', role: 'member' },
    });
    expect(rule).toMatchObject({ mapId, subjectKind: 'corporation', role: 'member' });
    expect((await pilot.request(`/api/maps/${mapId}/access-rules`)).status).toBe(403);
    expect((await owner.json<AccessRuleDto[]>(`/api/maps/${mapId}/access-rules`)).map((r) => r.id)).toEqual([
      rule.id,
    ]);
    const invalid = await owner.request(`/api/maps/${mapId}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'character', subjectId: 'abc', role: 'viewer' },
    });
    expect(invalid.status).toBe(400);

    const socket = new WebSocket(`ws://${base}/ws`, { headers: { cookie: pilot.cookieHeader } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: `map:${mapId}` }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    // Removing the rule drops the subscription.
    expect(
      (await owner.request(`/api/maps/${mapId}/access-rules/${rule.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({ op: 'error', stream: `map:${mapId}`, code: 'forbidden' }),
      ),
    );
    socket.close();
    expect(pilotMe.account.instanceRole).toBe('user');
  });

  it('closes the sockets of a session that logged out', async () => {
    const pilot = browser();
    await pilot.json<MeDto>('/api/auth/dev', { method: 'POST', json: { name: 'pilot' } });
    const socket = new WebSocket(`ws://${base}/ws`, { headers: { cookie: pilot.cookieHeader } });
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    socket.send(JSON.stringify({ op: 'subscribe', stream: 'instance' }));
    await vi.waitFor(() => expect(messages.some((m) => m.op === 'subscribed')).toBe(true));

    expect((await pilot.request('/api/auth/logout', { method: 'POST' })).status).toBe(204);
    expect(await closed).toBe(1008);
  });
});
