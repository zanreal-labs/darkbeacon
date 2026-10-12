import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect, type TestDatabase } from '@darkbeacon/db/testing';
import type {
  AccessRuleDto,
  AccountSummaryDto,
  AuthProvidersDto,
  DiscordBotDto,
  DiscordChannelDto,
  DiscordGuildDto,
  DiscordRoleDto,
  EveEntityDto,
  EveSearchResultDto,
  InstanceInfoDto,
  LandingDto,
  MapDto,
  MeDto,
  SessionDto,
} from '@darkbeacon/shared';
import {
  DISCORD_CLIENT,
  EVE_CLIENT,
  FakeNetwork,
  type EveCharacter,
} from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';

const pilot = (id: number, name: string, owner = `owner-${id}`): EveCharacter => ({
  id,
  name,
  owner,
  corporationId: 98000001,
});

describeEachDialect('accounts, EVE sign-in, pickers and the landing map', (t) => {
  let app: NestFastifyApplication;
  let base: string;
  let network: FakeNetwork;
  const browser = (userAgent?: string) => new Browser(base, userAgent);

  async function start(db: TestDatabase['db'], env: Record<string, string>) {
    network = new FakeNetwork();
    const config = {
      ...parseEnv({
        NODE_ENV: 'test',
        PUBLIC_URL: 'http://ww.test',
        EVE_CLIENT_ID: EVE_CLIENT.clientId,
        EVE_CLIENT_SECRET: EVE_CLIENT.clientSecret,
        DEMO_MODE: 'true',
        ...env,
      }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: db, logger: false, fetch: network.fetch });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('signs people in with EVE when Discord is not configured', async () => {
    await start(t.db, {});
    const providers = await browser().json<AuthProvidersDto>('/api/auth/providers');
    expect(providers).toMatchObject({ discord: false, eve: true, loginMethod: 'eve' });

    // The first sign-in of a character creates an account, named after it, with it as main.
    const ayla = pilot(2112000001, 'Ayla Vex');
    const alice = browser();
    expect(
      await alice.oauth('/api/auth/eve/signin?returnTo=/m/home', (c) => network.approveEve(ayla, c)),
    ).toBe('/m/home');
    const me = await alice.json<MeDto>('/api/accounts/me');
    expect(me.account).toMatchObject({ name: 'Ayla Vex', instanceRole: 'owner', mainCharacterId: ayla.id });
    expect(me.characters).toEqual([expect.objectContaining({ id: ayla.id, canSearch: true })]);

    // An alt linked while signed in joins the account.
    const alt = pilot(2112000002, 'Torren Kade');
    expect(await alice.oauth('/api/auth/eve/login', (c) => network.approveEve(alt, c))).toBe('/');
    expect((await alice.json<MeDto>('/api/accounts/me')).characters.map((c) => c.name)).toEqual([
      'Ayla Vex',
      'Torren Kade',
    ]);

    // Signing in with the alt elsewhere opens the same account.
    const laptop = browser();
    await laptop.oauth('/api/auth/eve/signin', (c) => network.approveEve(alt, c));
    expect((await laptop.json<MeDto>('/api/accounts/me')).account.id).toBe(me.account.id);

    // An unknown character signing in while signed out gets an account of its own.
    const bob = browser();
    await bob.oauth('/api/auth/eve/signin', (c) => network.approveEve(pilot(2112000003, 'Bob'), c));
    const bobMe = await bob.json<MeDto>('/api/accounts/me');
    expect(bobMe.account).toMatchObject({ name: 'Bob', instanceRole: 'user' });
    expect(bobMe.account.id).not.toBe(me.account.id);

    // A sold character (new EVE owner) signing in is a new account, the old one loses it.
    const sold = browser();
    await sold.oauth('/api/auth/eve/signin', (c) => network.approveEve({ ...alt, owner: 'buyer' }, c));
    expect((await sold.json<MeDto>('/api/accounts/me')).account.id).not.toBe(me.account.id);
    expect((await alice.json<MeDto>('/api/accounts/me')).characters.map((c) => c.name)).toEqual(['Ayla Vex']);

    // Discord sign-in is not offered, and the admin cannot switch to it.
    expect((await alice.request('/api/auth/discord/login')).headers.get('location')).toMatch(/auth_error=/);
    const patch = await alice.request('/api/admin/settings', {
      method: 'PATCH',
      json: { loginMethod: 'discord' },
    });
    expect(patch.status).toBe(400);
    expect(await alice.json<InstanceInfoDto>('/api/instance')).toEqual({
      defaultMapId: null,
      loginMethod: 'eve',
      discordRoles: false,
      discordBot: false,
      publicMaps: true,
      mcpMode: 'off',
    });
  });

  it('lets an EVE instance connect Discord accounts, and keeps Discord sign-in to them', async () => {
    await start(t.db, {
      DISCORD_CLIENT_ID: DISCORD_CLIENT.clientId,
      DISCORD_CLIENT_SECRET: DISCORD_CLIENT.clientSecret,
    });
    const owner = browser();
    await owner.json('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
    await owner.json('/api/admin/settings', { method: 'PATCH', json: { loginMethod: 'eve' } });
    expect((await browser().json<AuthProvidersDto>('/api/auth/providers')).loginMethod).toBe('eve');

    const user = { id: '3001', username: 'owner#1', global_name: 'Owner', avatar: null };
    expect(
      await owner.oauth('/api/auth/discord/connect?returnTo=/account', (c) =>
        network.approveDiscord(user, c),
      ),
    ).toBe('/account');
    expect((await owner.json<MeDto>('/api/accounts/me')).account.discordId).toBe('3001');

    // Signing in with that Discord user opens the account; an unknown one is refused.
    const phone = browser();
    await phone.oauth('/api/auth/discord/login', (c) => network.approveDiscord(user, c));
    expect((await phone.json<MeDto>('/api/accounts/me')).account.name).toBe('owner');
    const stranger = browser();
    const refused = await stranger.oauth('/api/auth/discord/login', (c) =>
      network.approveDiscord({ id: '3002', username: 'x', global_name: null, avatar: null }, c),
    );
    expect(new URL(refused, 'http://x').searchParams.get('auth_error')).toMatch(/EVE Online/);

    expect((await owner.request('/api/accounts/me/discord', { method: 'DELETE' })).status).toBe(204);
    expect((await owner.json<MeDto>('/api/accounts/me')).account.discordId).toBeNull();
  });

  it('lists and revokes sessions, marking the current one', async () => {
    await start(t.db, {});
    const desktop = browser();
    await desktop.json('/api/auth/dev', { method: 'POST', json: { name: 'pilot' } });
    const phone = browser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    );
    await phone.json('/api/auth/dev', { method: 'POST', json: { name: 'pilot' } });

    const sessions = await desktop.json<SessionDto[]>('/api/accounts/me/sessions');
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.current)).toMatchObject({
      browser: 'Safari',
      os: 'macOS',
      device: 'desktop',
    });
    const other = sessions.find((s) => !s.current)!;
    expect(other).toMatchObject({ browser: 'Safari', os: 'iPhone', device: 'mobile' });

    expect(
      (await desktop.request(`/api/accounts/me/sessions/${other.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect((await phone.request('/api/accounts/me')).status).toBe(401);
    expect(await desktop.json<SessionDto[]>('/api/accounts/me/sessions')).toHaveLength(1);
    expect((await desktop.request('/api/accounts/me/sessions/nope', { method: 'DELETE' })).status).toBe(404);
  });

  it('lands on the starred map, the instance default, the last opened or the only one', async () => {
    await start(t.db, {});
    const owner = browser();
    await owner.json('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
    const landing = () => owner.json<LandingDto>('/api/accounts/me/landing');
    // Demo mode seeds no map for named accounts.
    expect(await landing()).toEqual({ slug: null, reason: null });

    const a = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Alpha' } });
    expect(await landing()).toEqual({ slug: 'alpha', reason: 'only' });
    const b = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Bravo' } });
    expect(await landing()).toEqual({ slug: 'alpha', reason: 'first' });

    await owner.request('/api/accounts/me/recent-map', { method: 'PUT', json: { mapId: b.id } });
    expect(await landing()).toEqual({ slug: 'bravo', reason: 'recent' });
    expect((await owner.json<MeDto>('/api/accounts/me')).account.recentMapIds).toEqual([b.id]);

    await owner.json('/api/admin/settings', { method: 'PATCH', json: { defaultMapId: a.id } });
    expect(await landing()).toEqual({ slug: 'alpha', reason: 'instance' });

    const starred = await owner.json<MeDto>('/api/accounts/me/default-map', {
      method: 'PUT',
      json: { mapId: b.id },
    });
    expect(starred.account.defaultMapId).toBe(b.id);
    expect(await landing()).toEqual({ slug: 'bravo', reason: 'account' });

    // A starred map that is gone falls through to the next rule.
    await owner.request(`/api/maps/${b.id}`, { method: 'DELETE' });
    expect(await landing()).toEqual({ slug: 'alpha', reason: 'instance' });
  });

  it('finds EVE names through ESI search, falls back to exact names and describes rules', async () => {
    await start(t.db, {});
    network.esiEntities.set(98000077, { name: 'Hard Knocks Inc.', category: 'corporation', ticker: 'HKRAB' });
    network.esiEntities.set(98000078, {
      name: 'Hard Knocks Citizens',
      category: 'corporation',
      ticker: 'HKC',
    });
    network.esiEntities.set(2112000009, { name: 'Hard Pilot', category: 'character' });

    const owner = browser();
    await owner.oauth('/api/auth/eve/signin', (c) => network.approveEve(pilot(2112000001, 'Owner'), c));
    network.esiEntities.set(2112000001, { name: 'Owner', category: 'character' });
    const found = await owner.json<EveSearchResultDto>(
      '/api/eve/search?category=corporation&q=hard%20knocks',
    );
    expect(found.mode).toBe('search');
    expect(found.relinkToSearch).toBe(false);
    expect(found.results.map((r) => [r.name, r.ticker])).toEqual([
      ['Hard Knocks Citizens', 'HKC'],
      ['Hard Knocks Inc.', 'HKRAB'],
    ]);

    // A character linked before search was asked for: exact names only, and a hint to re-link.
    network.eveScopes = ['esi-location.read_location.v1'];
    const old = browser();
    await old.oauth('/api/auth/eve/signin', (c) => network.approveEve(pilot(2112000004, 'Old'), c));
    const exact = await old.json<EveSearchResultDto>(
      '/api/eve/search?category=corporation&q=hard%20knocks%20inc.',
    );
    expect(exact).toEqual({
      mode: 'exact',
      relinkToSearch: true,
      results: [{ id: 98000077, name: 'Hard Knocks Inc.', category: 'corporation', ticker: 'HKRAB' }],
    });

    expect(await owner.json<EveEntityDto[]>('/api/eve/entities?ids=98000077,2112000009,5')).toEqual([
      { id: 98000077, name: 'Hard Knocks Inc.', category: 'corporation', ticker: 'HKRAB' },
      { id: 2112000009, name: 'Hard Pilot', category: 'character', ticker: null },
    ]);

    // Rules show names, not ids.
    const map = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Chain' } });
    await owner.json(`/api/maps/${map.id}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'corporation', subjectId: '98000077', role: 'member' },
    });
    const [rule] = await owner.json<AccessRuleDto[]>(`/api/maps/${map.id}/access-rules`);
    expect(rule!.subject).toEqual({
      name: 'Hard Knocks Inc.',
      detail: '[HKRAB]',
      imageUrl: 'https://images.evetech.net/corporations/98000077/logo?size=64',
    });

    // Account search is for map admins: the owner of a map may, someone without one may not.
    expect((await owner.json<AccountSummaryDto[]>('/api/accounts/search?q=old')).map((a) => a.name)).toEqual([
      'Old',
    ]);
    expect((await old.request('/api/accounts/search?q=own')).status).toBe(403);
  });

  it('connects a Discord bot and lists its servers, roles and channels', async () => {
    await start(t.db, {});
    const owner = browser();
    await owner.json('/api/auth/dev', { method: 'POST', json: { name: 'owner' } });
    expect(await owner.json<DiscordBotDto>('/api/admin/discord-bot')).toMatchObject({ configured: false });
    expect(await owner.json<DiscordGuildDto[]>('/api/discord/guilds')).toEqual([]);

    const bad = await owner.request('/api/admin/discord-bot', {
      method: 'PUT',
      json: { token: 'x'.repeat(40) },
    });
    expect(bad.status).toBe(400);

    network.botTokens.add('b'.repeat(40));
    network.botGuilds.push({ id: '500', name: 'Hard Knocks', icon: null });
    network.botRoles.set('500', [
      { id: '500', name: '@everyone', color: 0, managed: false, position: 0 },
      { id: '501', name: 'Scouts', color: 0x3fbf7f, managed: false, position: 2 },
      { id: '502', name: 'FC', color: 0, managed: false, position: 5 },
    ]);
    network.botChannels.set('500', [
      { id: '600', name: 'Ops', type: 4, position: 0 },
      { id: '601', name: 'alerts', type: 0, position: 1, parent_id: '600' },
      { id: '602', name: 'voice', type: 2, position: 2 },
    ]);
    const bot = await owner.json<DiscordBotDto>('/api/admin/discord-bot', {
      method: 'PUT',
      json: { token: 'b'.repeat(40) },
    });
    expect(bot).toMatchObject({ configured: true, name: 'Beacon', error: null });
    expect(bot.inviteUrl).toContain('client_id=7001');
    expect((await owner.json<InstanceInfoDto>('/api/instance')).discordBot).toBe(true);

    expect(await owner.json<DiscordGuildDto[]>('/api/discord/guilds')).toEqual([
      { id: '500', name: 'Hard Knocks', iconUrl: null },
    ]);
    expect(await owner.json<DiscordRoleDto[]>('/api/discord/guilds/500/roles')).toEqual([
      { id: '502', name: 'FC', color: null, managed: false },
      { id: '501', name: 'Scouts', color: '#3fbf7f', managed: false },
    ]);
    expect(await owner.json<DiscordChannelDto[]>('/api/discord/guilds/500/channels')).toEqual([
      { id: '601', name: 'alerts', kind: 'text', category: 'Ops' },
    ]);
    // The token never comes back.
    expect(JSON.stringify(bot)).not.toContain('b'.repeat(40));

    const pilot2 = browser();
    await pilot2.json('/api/auth/dev', { method: 'POST', json: { name: 'pilot' } });
    expect((await pilot2.request('/api/discord/guilds')).status).toBe(403);
    expect((await owner.request('/api/admin/discord-bot', { method: 'DELETE' })).status).toBe(204);
    expect(await owner.json<DiscordBotDto>('/api/admin/discord-bot')).toMatchObject({ configured: false });
  });
});
