import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from '@darkbeacon/core';
import { ExternalAuthError, pkceChallenge } from '@darkbeacon/identity';
import { DiscordHttpProvider } from './discord-http.js';
import { EveSsoHttp } from './eve-sso-http.js';
import { DISCORD_CLIENT, EVE_CLIENT, FakeNetwork, type EveCharacter } from './fake-network.js';
import { SecretBox } from './secret-box.js';

const pilot: EveCharacter = {
  id: 2112000001,
  name: 'Test Pilot',
  owner: 'owner-hash',
  corporationId: 98000001,
  allianceId: 99000001,
};

describe('SecretBox', () => {
  it('round-trips, uses a fresh IV and rejects tampering or another purpose', () => {
    const box = new SecretBox('k'.repeat(32), 'eve-tokens');
    const a = box.seal('secret');
    expect(a).not.toContain('secret');
    expect(box.seal('secret')).not.toBe(a);
    expect(box.open(a)).toBe('secret');
    expect(new SecretBox('k'.repeat(32), 'discord-tokens').open(a)).toBeNull();
    expect(new SecretBox('x'.repeat(32), 'eve-tokens').open(a)).toBeNull();
    const parts = a.split('.');
    parts[2] = Buffer.from('tampered').toString('base64url');
    expect(box.open(parts.join('.'))).toBeNull();
    expect(box.open('garbage')).toBeNull();
    expect(() => box.openOrThrow('garbage')).toThrow(/SECRET_KEY/);
  });
});

describe('EveSsoHttp', () => {
  let network: FakeNetwork;
  let clock: ManualClock;
  let eve: EveSsoHttp;

  beforeEach(() => {
    network = new FakeNetwork();
    clock = new ManualClock(Date.now());
    network.now = () => clock.now();
    eve = new EveSsoHttp(EVE_CLIENT, clock, network.fetch);
  });

  it('builds a PKCE authorization URL', () => {
    const url = new URL(
      eve.authorizationUrl({
        state: 's',
        codeChallenge: 'c',
        redirectUri: 'https://x/cb',
        scopes: ['a', 'b'],
      }),
    );
    expect(url.origin + url.pathname).toBe('https://login.eveonline.com/v2/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'eve-client',
      redirect_uri: 'https://x/cb',
      scope: 'a b',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges a code with the verifier, verifies the JWT against the JWKS and refreshes', async () => {
    const verifier = 'v'.repeat(43);
    const code = network.approveEve(pilot, await pkceChallenge(verifier));
    const tokens = await eve.exchangeCode({ code, codeVerifier: verifier, redirectUri: 'https://x/cb' });
    expect(tokens.identity).toEqual({
      characterId: pilot.id,
      characterName: 'Test Pilot',
      ownerHash: 'owner-hash',
      scopes: network.eveScopes,
    });
    expect(tokens.expiresAt).toBe(clock.now() + 1_199_000);
    // Metadata and keys were discovered through the metadata document.
    expect(network.calls[0]).toBe('GET https://login.eveonline.com/.well-known/oauth-authorization-server');

    const refreshed = await eve.refresh(tokens.refreshToken);
    expect(refreshed.refreshToken).not.toBe(tokens.refreshToken);
    await expect(eve.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(ExternalAuthError);
    expect(await eve.affiliation(pilot.id)).toEqual({ corporationId: 98000001, allianceId: 99000001 });
  });

  it('refuses a wrong verifier', async () => {
    const code = network.approveEve(pilot, await pkceChallenge('right'.repeat(9)));
    await expect(
      eve.exchangeCode({ code, codeVerifier: 'wrong'.repeat(9), redirectUri: 'https://x/cb' }),
    ).rejects.toBeInstanceOf(ExternalAuthError);
  });

  it('rejects tokens with a bad signature, issuer, audience, expiry or subject', async () => {
    expect((await eve.verify(network.eveJwt(pilot))).characterId).toBe(pilot.id);
    expect((await eve.verify(network.eveJwt(pilot, { iss: 'login.eveonline.com' }))).characterId).toBe(
      pilot.id,
    );

    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const bad = [
      network.eveJwt(pilot, {}, other),
      network.eveJwt(pilot, { iss: 'https://evil.example' }),
      network.eveJwt(pilot, { aud: ['someone-else', 'EVE Online'] }),
      network.eveJwt(pilot, { aud: ['eve-client'] }),
      network.eveJwt(pilot, { exp: Math.floor(clock.now() / 1000) - 1 }),
      network.eveJwt(pilot, { sub: 'CORPORATION:EVE:1' }),
      network.eveJwt(pilot, {}, undefined, 'unknown-kid'),
      'not.a.jwt',
      'onlyonepart',
    ];
    for (const token of bad) await expect(eve.verify(token)).rejects.toBeInstanceOf(ExternalAuthError);
  });

  it('accepts an ES256 key from the key set', async () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const fetchEc: typeof network.fetch = async (url, init) => {
      if (url.endsWith('/oauth/jwks')) {
        return new Response(
          JSON.stringify({ keys: [{ ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec', alg: 'ES256' }] }),
        );
      }
      return network.fetch(url, init);
    };
    const esEve = new EveSsoHttp(EVE_CLIENT, clock, fetchEc);
    const [, payload] = network.eveJwt(pilot).split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'ec' })).toString('base64url');
    const { sign } = await import('node:crypto');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: ec.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    expect((await esEve.verify(`${header}.${payload}.${signature.toString('base64url')}`)).characterId).toBe(
      pilot.id,
    );
  });
});

describe('DiscordHttpProvider', () => {
  it('signs in, reads guild roles and reports a revoked grant', async () => {
    const network = new FakeNetwork();
    const clock = new ManualClock();
    const discord = new DiscordHttpProvider(DISCORD_CLIENT, clock, network.fetch);

    const url = new URL(
      discord.authorizationUrl({ state: 's', redirectUri: 'https://x/cb', codeChallenge: 'c' }),
    );
    expect(url.searchParams.get('scope')).toBe('identify guilds guilds.members.read');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const verifier = 'w'.repeat(43);
    const code = network.approveDiscord(
      { id: '42', username: 'pilot', global_name: 'Pilot', avatar: 'abc' },
      await pkceChallenge(verifier),
    );
    const grant = await discord.exchangeCode({ code, redirectUri: 'https://x/cb', codeVerifier: verifier });
    expect(grant.profile).toEqual({
      id: '42',
      username: 'pilot',
      globalName: 'Pilot',
      avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png',
    });
    expect(grant.expiresAt).toBe(clock.now() + 604_800_000);

    network.guildRoles.set('42|100', ['7', '8']);
    expect(await discord.guildRoles(grant.accessToken, '100')).toEqual(['7', '8']);
    expect(await discord.guildRoles(grant.accessToken, '200')).toBeNull();

    const refreshed = await discord.refresh(grant.refreshToken);
    expect(refreshed.profile.id).toBe('42');
    await expect(discord.guildRoles('revoked', '100')).rejects.toBeInstanceOf(ExternalAuthError);
    await expect(discord.refresh(grant.refreshToken)).rejects.toBeInstanceOf(ExternalAuthError);
    await expect(discord.exchangeCode({ code, redirectUri: 'https://x/cb' })).rejects.toBeInstanceOf(
      ExternalAuthError,
    );
  });
});
