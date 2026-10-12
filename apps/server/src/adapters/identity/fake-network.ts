// Test double of the Discord, EVE SSO and ESI endpoints the identity adapters call.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FetchLike } from './oauth-http.js';

export const EVE_CLIENT = { clientId: 'eve-client', clientSecret: 'eve-secret' };
export const DISCORD_CLIENT = { clientId: 'discord-client', clientSecret: 'discord-secret' };
const EVE_KID = 'JWT-Signature-Key';

interface PendingCode<T> {
  value: T;
  /** PKCE challenge the code was issued for; the token request must present its verifier. */
  challenge: string | null;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface EveCharacter {
  id: number;
  name: string;
  owner: string;
  corporationId: number;
  allianceId?: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeNetwork {
  readonly eveKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly calls: string[] = [];
  now = () => Date.now();

  readonly discordCodes = new Map<string, PendingCode<DiscordUser>>();
  readonly discordTokens = new Map<string, DiscordUser>();
  readonly discordRefresh = new Map<string, DiscordUser>();
  /** `${userId}|${guildId}` -> role ids. */
  readonly guildRoles = new Map<string, string[]>();

  readonly eveCodes = new Map<string, PendingCode<EveCharacter>>();
  readonly eveRefresh = new Map<string, EveCharacter>();
  readonly characters = new Map<number, EveCharacter>();
  /** Scopes EVE SSO grants (the `scp` claim of new tokens). */
  eveScopes = [
    'esi-location.read_location.v1',
    'esi-location.read_ship_type.v1',
    'esi-location.read_online.v1',
    'esi-search.search_structures.v1',
    'esi-characters.read_contacts.v1',
    'esi-corporations.read_contacts.v1',
    'esi-alliances.read_contacts.v1',
  ];
  /** What ESI knows by id: names, categories, tickers (for search, /universe/names and /ids). */
  readonly esiEntities = new Map<number, { name: string; category: string; ticker?: string }>();

  /** Discord bot tokens Discord accepts, and what the bot sees. */
  readonly botTokens = new Set<string>();
  readonly botGuilds: Array<{ id: string; name: string; icon: string | null }> = [];
  readonly botRoles = new Map<
    string,
    Array<{ id: string; name: string; color: number; managed: boolean; position: number }>
  >();
  readonly botChannels = new Map<
    string,
    Array<{ id: string; name: string; type: number; position: number; parent_id?: string | null }>
  >();
  /** Messages posted by the bot (channel id) or through webhooks (`webhook:<id>`). */
  readonly discordMessages: Array<{ to: string; body: Record<string, unknown> }> = [];
  /** Channel webhooks Discord knows: `<id>/<token>` -> channel and guild. */
  readonly discordWebhooks = new Map<string, { channelId: string; guildId: string; name: string }>();
  private counter = 0;

  /** Issues a Discord authorization code, as if the user approved the login. */
  approveDiscord(user: DiscordUser, challenge: string | null): string {
    const code = `dc-${++this.counter}`;
    this.discordCodes.set(code, { value: user, challenge });
    return code;
  }

  approveEve(character: EveCharacter, challenge: string | null): string {
    this.characters.set(character.id, character);
    const code = `ec-${++this.counter}`;
    this.eveCodes.set(code, { value: character, challenge });
    return code;
  }

  /** A signed EVE SSO access token; override claims or the key to forge bad ones. */
  eveJwt(
    character: EveCharacter,
    overrides: Record<string, unknown> = {},
    key: KeyObject = this.eveKey.privateKey,
    kid = EVE_KID,
  ): string {
    const now = Math.floor(this.now() / 1000);
    const header = { alg: 'RS256', kid, typ: 'JWT' };
    const payload = {
      scp: this.eveScopes,
      jti: `jti-${++this.counter}`,
      kid,
      sub: `CHARACTER:EVE:${character.id}`,
      azp: EVE_CLIENT.clientId,
      tenant: 'tranquility',
      tier: 'live',
      region: 'world',
      aud: [EVE_CLIENT.clientId, 'EVE Online'],
      name: character.name,
      owner: character.owner,
      exp: now + 1200,
      iat: now,
      iss: 'https://login.eveonline.com',
      ...overrides,
    };
    const encode = (part: unknown) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const signed = `${encode(header)}.${encode(payload)}`;
    return `${signed}.${sign('sha256', Buffer.from(signed), key).toString('base64url')}`;
  }

  readonly fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    this.calls.push(`${method} ${url}`);
    const u = new URL(url);
    const auth = new Headers(init.headers).get('authorization') ?? '';
    const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '');

    if (u.host === 'login.eveonline.com') {
      if (u.pathname === '/.well-known/oauth-authorization-server') {
        return json({
          issuer: 'https://login.eveonline.com',
          token_endpoint: 'https://login.eveonline.com/v2/oauth/token',
          jwks_uri: 'https://login.eveonline.com/oauth/jwks',
        });
      }
      if (u.pathname === '/oauth/jwks') {
        return json({
          keys: [{ ...this.eveKey.publicKey.export({ format: 'jwk' }), kid: EVE_KID, alg: 'RS256' }],
        });
      }
      if (u.pathname === '/v2/oauth/token') return this.eveToken(auth, form);
    }
    if (u.host === 'discord.com' && auth.startsWith('Bot ')) return this.discordBot(auth, method, u, init);
    if (u.host === 'discord.com' && u.pathname.startsWith('/api/webhooks/')) {
      const key = u.pathname.slice('/api/webhooks/'.length);
      const hook = this.discordWebhooks.get(key);
      if (!hook) return json({ message: 'Unknown Webhook', code: 10015 }, 404);
      if (method === 'GET')
        return json({
          id: key.split('/')[0],
          channel_id: hook.channelId,
          guild_id: hook.guildId,
          name: hook.name,
        });
      this.discordMessages.push({
        to: `webhook:${key.split('/')[0]}`,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return json({ id: `m-${++this.counter}` });
    }
    if (u.host === 'esi.evetech.net') {
      const esi = this.esi(method, u, init);
      if (esi) return esi;
    }
    if (u.host === 'discord.com') {
      if (u.pathname === '/api/v10/oauth2/token') return this.discordToken(auth, form);
      const user = this.discordTokens.get(auth.replace(/^Bearer /, ''));
      if (!user) return json({ message: '401: Unauthorized' }, 401);
      if (u.pathname === '/api/v10/users/@me') return json(user);
      const member = /^\/api\/v10\/users\/@me\/guilds\/(\d+)\/member$/.exec(u.pathname);
      if (member) {
        const roles = this.guildRoles.get(`${user.id}|${member[1]}`);
        return roles ? json({ roles }) : json({ message: 'Unknown Guild', code: 10004 }, 404);
      }
    }
    if (u.host === 'esi.evetech.net' && u.pathname === '/characters/affiliation') {
      const ids = JSON.parse(String(init.body)) as number[];
      return json(
        ids.flatMap((id) => {
          const c = this.characters.get(id);
          return c ? [{ character_id: id, corporation_id: c.corporationId, alliance_id: c.allianceId }] : [];
        }),
      );
    }
    return json({ error: 'not found' }, 404);
  };

  /** Character search, /universe/names and /ids, corporations and alliances. */
  private esi(method: string, u: URL, init: RequestInit): Response | null {
    const entity = (id: number) => this.esiEntities.get(id);
    const search = /^\/characters\/(\d+)\/search$/.exec(u.pathname);
    if (search && method === 'GET') {
      const token = (new Headers(init.headers).get('authorization') ?? '').replace(/^Bearer /, '');
      const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}') as {
        scp?: string[];
        sub?: string;
      };
      if (
        claims.sub !== `CHARACTER:EVE:${search[1]}` ||
        !claims.scp?.includes('esi-search.search_structures.v1')
      ) {
        return json({ error: 'token is not valid for scope(s): esi-search.search_structures.v1' }, 403);
      }
      const category = u.searchParams.get('categories') ?? '';
      const text = (u.searchParams.get('search') ?? '').toLowerCase();
      if (text.length < 3) return json({ error: 'search must be at least 3 characters' }, 400);
      const ids = [...this.esiEntities]
        .filter(([, e]) => e.category === category && e.name.toLowerCase().includes(text))
        .map(([id]) => id);
      return json(ids.length > 0 ? { [category]: ids } : {});
    }
    if (u.pathname === '/universe/names' && method === 'POST') {
      const ids = JSON.parse(String(init.body)) as number[];
      if (ids.some((id) => !entity(id)))
        return json({ error: 'Ensure all IDs are valid before resolving.' }, 404);
      return json(ids.map((id) => ({ id, name: entity(id)!.name, category: entity(id)!.category })));
    }
    if (u.pathname === '/universe/ids' && method === 'POST') {
      const names = (JSON.parse(String(init.body)) as string[]).map((n) => n.toLowerCase());
      const out: Record<string, Array<{ id: number; name: string }>> = {};
      for (const [id, e] of this.esiEntities) {
        if (!names.includes(e.name.toLowerCase())) continue;
        (out[`${e.category}s`] ??= []).push({ id, name: e.name });
      }
      return json(out);
    }
    const detail = /^\/(corporations|alliances)\/(\d+)$/.exec(u.pathname);
    if (detail) {
      const e = entity(Number(detail[2]));
      return e && `${e.category}s` === detail[1]
        ? json({ name: e.name, ticker: e.ticker ?? 'TICK' })
        : json({ error: 'not found' }, 404);
    }
    return null;
  }

  private discordBot(auth: string, method: string, u: URL, init: RequestInit): Response {
    if (!this.botTokens.has(auth.slice(4))) return json({ message: '401: Unauthorized', code: 0 }, 401);
    const path = u.pathname.replace(/^\/api\/v10/, '');
    if (path === '/users/@me')
      return json({ id: '7001', username: 'darkbeacon', global_name: 'Beacon', avatar: null });
    if (path === '/users/@me/guilds') return json(this.botGuilds);
    const roles = /^\/guilds\/(\d+)\/roles$/.exec(path);
    if (roles) return json(this.botRoles.get(roles[1]!) ?? []);
    const channels = /^\/guilds\/(\d+)\/channels$/.exec(path);
    if (channels) return json(this.botChannels.get(channels[1]!) ?? []);
    const post = /^\/channels\/(\d+)\/messages$/.exec(path);
    if (post && method === 'POST') {
      const known = [...this.botChannels.values()].some((list) => list.some((c) => c.id === post[1]));
      if (!known) return json({ message: 'Unknown Channel', code: 10003 }, 404);
      this.discordMessages.push({
        to: post[1]!,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return json({ id: `m-${++this.counter}` });
    }
    return json({ message: '404: Not Found', code: 0 }, 404);
  }

  private eveToken(auth: string, form: URLSearchParams): Response {
    if (auth !== basic(EVE_CLIENT)) return json({ error: 'invalid_client' }, 401);
    let character: EveCharacter | undefined;
    if (form.get('grant_type') === 'authorization_code') {
      character = this.redeem(this.eveCodes, form);
    } else if (form.get('grant_type') === 'refresh_token') {
      character = this.eveRefresh.get(form.get('refresh_token') ?? '');
      this.eveRefresh.delete(form.get('refresh_token') ?? '');
    }
    if (!character) return json({ error: 'invalid_grant', error_description: 'Invalid code' }, 400);
    const refresh = `er-${++this.counter}`;
    this.eveRefresh.set(refresh, character);
    return json({
      access_token: this.eveJwt(character),
      token_type: 'Bearer',
      expires_in: 1199,
      refresh_token: refresh,
    });
  }

  private discordToken(auth: string, form: URLSearchParams): Response {
    if (auth !== basic(DISCORD_CLIENT)) return json({ error: 'invalid_client' }, 401);
    let user: DiscordUser | undefined;
    if (form.get('grant_type') === 'authorization_code') {
      user = this.redeem(this.discordCodes, form);
    } else if (form.get('grant_type') === 'refresh_token') {
      user = this.discordRefresh.get(form.get('refresh_token') ?? '');
      this.discordRefresh.delete(form.get('refresh_token') ?? '');
    }
    if (!user) return json({ error: 'invalid_grant' }, 400);
    const access = `da-${++this.counter}`;
    const refresh = `dr-${this.counter}`;
    this.discordTokens.set(access, user);
    this.discordRefresh.set(refresh, user);
    return json({ access_token: access, token_type: 'Bearer', expires_in: 604800, refresh_token: refresh });
  }

  /** One-time code redemption with the PKCE check of RFC 7636 (S256). */
  private redeem<T>(codes: Map<string, PendingCode<T>>, form: URLSearchParams): T | undefined {
    const pending = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    if (!pending) return undefined;
    if (pending.challenge !== null) {
      const verifier = form.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== pending.challenge) return undefined;
    }
    return pending.value;
  }
}

function basic(client: { clientId: string; clientSecret: string }): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`;
}
