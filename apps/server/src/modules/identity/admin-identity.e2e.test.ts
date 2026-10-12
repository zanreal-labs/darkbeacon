import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { describeEachDialect } from '@darkbeacon/db/testing';
import type {
  AdminAccountDto,
  AdminCharacterDto,
  CreatedInviteDto,
  InviteDto,
  MapDto,
  MeDto,
} from '@darkbeacon/shared';
import { EVE_CLIENT, FakeNetwork, type EveCharacter } from '../../adapters/identity/fake-network.js';
import { createApp } from '../../app.js';
import { parseEnv } from '../../config/config.js';
import { Browser } from '../../test-support/browser.js';

const pilot = (id: number, name: string, corporationId = 98000002, allianceId?: number): EveCharacter => ({
  id,
  name,
  owner: `owner-${id}`,
  corporationId,
  ...(allianceId ? { allianceId } : {}),
});

describeEachDialect('instance admins: sign-up, characters and disabled accounts', (t) => {
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
        EVE_CLIENT_ID: EVE_CLIENT.clientId,
        EVE_CLIENT_SECRET: EVE_CLIENT.clientSecret,
      }),
      secretKey: 's'.repeat(32),
    };
    app = await createApp(config, { database: t.db, logger: false, fetch: network.fetch });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await app.close();
  });

  /** Signs in with EVE; the path the callback sent the browser to. */
  const signIn = (b: Browser, who: EveCharacter, invite?: string) =>
    b.oauth(`/api/auth/eve/signin${invite ? `?invite=${invite}` : ''}`, (c) => network.approveEve(who, c));

  it('restricts sign-up to allowed corporations, alliances and invite links', async () => {
    const owner = browser();
    expect(await signIn(owner, pilot(2112000001, 'Ayla Vex', 98000001))).toBe('/');
    const restricted = await owner.request('/api/admin/settings', {
      method: 'PATCH',
      json: {
        signIn: { mode: 'restricted', corporationIds: [98000001], allianceIds: [99000001], guildIds: [] },
      },
    });
    expect(restricted.status).toBe(200);

    // A stranger is refused, with a word on how to get in; nothing is created.
    const stranger = browser();
    const refused = await signIn(stranger, pilot(2112000002, 'Bob'));
    expect(decodeURIComponent(refused)).toMatch(/auth_error=.*invite/);
    expect((await stranger.request('/api/accounts/me')).status).toBe(401);
    expect(await owner.json<AdminAccountDto[]>('/api/admin/accounts')).toHaveLength(1);

    // An allowed alliance and an allowed corporation get in.
    expect(await signIn(browser(), pilot(2112000003, 'Carol', 98000005, 99000001))).toBe('/');
    expect(await signIn(browser(), pilot(2112000004, 'Dave', 98000001))).toBe('/');

    // An invite for one person: the stranger gets in with it, the next one does not.
    const created = await owner.json<CreatedInviteDto>('/api/admin/invites', {
      method: 'POST',
      json: { note: 'Bob from the new corp', maxUses: 1 },
    });
    expect(created.url).toBe(`http://ww.test/login?invite=${created.token}`);
    expect(await signIn(stranger, pilot(2112000002, 'Bob'), created.token)).toBe('/');
    expect((await stranger.json<MeDto>('/api/accounts/me')).account.name).toBe('Bob');
    const invites = await owner.json<InviteDto[]>('/api/admin/invites');
    expect(invites[0]).toMatchObject({ uses: 1, active: false, note: 'Bob from the new corp' });
    expect(decodeURIComponent(await signIn(browser(), pilot(2112000005, 'Eve'), created.token))).toMatch(
      /auth_error=/,
    );
    // Bob has an account now: he signs in without one.
    expect(await signIn(browser(), pilot(2112000002, 'Bob'))).toBe('/');

    // A revoked invite lets nobody in.
    const second = await owner.json<CreatedInviteDto>('/api/admin/invites', { method: 'POST', json: {} });
    expect((await owner.request(`/api/admin/invites/${second.invite.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect(decodeURIComponent(await signIn(browser(), pilot(2112000006, 'Finn'), second.token))).toMatch(
      /auth_error=/,
    );
  });

  it('lists and unlinks characters and disables accounts', async () => {
    const owner = browser();
    await signIn(owner, pilot(2112000001, 'Ayla Vex', 98000001));
    const bob = browser();
    await signIn(bob, pilot(2112000002, 'Bob'));
    const bobId = (await bob.json<MeDto>('/api/accounts/me')).account.id;
    const map = await owner.json<MapDto>('/api/maps', { method: 'POST', json: { name: 'Home' } });
    await owner.json(`/api/maps/${map.id}/access-rules`, {
      method: 'POST',
      json: { subjectKind: 'account', subjectId: bobId, role: 'member' },
    });
    expect((await bob.request(`/api/maps/${map.id}`)).status).toBe(200);

    const characters = await owner.json<AdminCharacterDto[]>('/api/admin/characters');
    expect(characters.map((c) => [c.name, c.accountName])).toEqual([
      ['Ayla Vex', 'Ayla Vex'],
      ['Bob', 'Bob'],
    ]);
    expect((await bob.request('/api/admin/characters')).status).toBe(403);

    // Disabled: the session ends, no sign-in, no maps; the owner cannot be disabled.
    const disabled = await owner.json<AdminAccountDto>(`/api/admin/accounts/${bobId}/disabled`, {
      method: 'PUT',
      json: { disabled: true, reason: 'left the corp' },
    });
    expect(disabled).toMatchObject({ disabledReason: 'left the corp', disabledAt: expect.any(Number) });
    expect((await bob.request('/api/accounts/me')).status).toBe(401);
    expect(decodeURIComponent(await signIn(browser(), pilot(2112000002, 'Bob')))).toMatch(
      /auth_error=.*disabled/,
    );
    const ownerId = (await owner.json<MeDto>('/api/accounts/me')).account.id;
    const self = await owner.request(`/api/admin/accounts/${ownerId}/disabled`, {
      method: 'PUT',
      json: { disabled: true },
    });
    expect(self.status).toBe(403);

    await owner.json(`/api/admin/accounts/${bobId}/disabled`, { method: 'PUT', json: { disabled: false } });
    const back = browser();
    expect(await signIn(back, pilot(2112000002, 'Bob'))).toBe('/');
    expect((await back.request(`/api/maps/${map.id}`)).status).toBe(200);

    // Unlinked by an admin: the character leaves Bob's account.
    expect((await owner.request(`/api/admin/characters/2112000002`, { method: 'DELETE' })).status).toBe(204);
    expect((await back.json<MeDto>('/api/accounts/me')).characters).toEqual([]);
  });
});
