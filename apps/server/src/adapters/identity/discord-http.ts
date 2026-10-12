import type { Clock } from '@darkbeacon/core';
import {
  ExternalAuthError,
  type DiscordGrant,
  type DiscordProfile,
  type IdentityProvider,
} from '@darkbeacon/identity';
import { requestToken, type FetchLike, type OAuthClient, type TokenResponse } from './oauth-http.js';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const API = 'https://discord.com/api/v10';
const SCOPES = 'identify guilds guilds.members.read';

/** Discord OAuth2 and the two REST calls we need (current user, member roles on a guild). */
export class DiscordHttpProvider implements IdentityProvider {
  constructor(
    private readonly client: OAuthClient,
    private readonly clock: Clock,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  authorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.client.clientId,
      scope: SCOPES,
      redirect_uri: input.redirectUri,
      state: input.state,
      prompt: 'none',
    });
    if (input.codeChallenge) {
      params.set('code_challenge', input.codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${AUTHORIZE_URL}?${params}`;
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<DiscordGrant> {
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    };
    if (input.codeVerifier) form.code_verifier = input.codeVerifier;
    return this.grant(await requestToken(this.fetchFn, 'discord', `${API}/oauth2/token`, this.client, form));
  }

  async refresh(refreshToken: string): Promise<DiscordGrant> {
    const form = { grant_type: 'refresh_token', refresh_token: refreshToken };
    return this.grant(await requestToken(this.fetchFn, 'discord', `${API}/oauth2/token`, this.client, form));
  }

  async guildRoles(accessToken: string, guildId: string): Promise<string[] | null> {
    const response = await this.get(accessToken, `/users/@me/guilds/${encodeURIComponent(guildId)}/member`);
    if (response.status === 404) return null;
    const member = (await response.json()) as { roles?: string[] };
    return member.roles ?? [];
  }

  private async grant(token: TokenResponse): Promise<DiscordGrant> {
    const response = await this.get(token.access_token, '/users/@me');
    const user = (await response.json()) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    };
    const profile: DiscordProfile = {
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
    };
    return {
      profile,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: this.clock.now() + token.expires_in * 1000,
    };
  }

  /** GET with the user's bearer token. 401 means the grant is gone; 404 is left to the caller. */
  private async get(accessToken: string, path: string): Promise<Response> {
    const response = await this.fetchFn(`${API}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) throw new ExternalAuthError('discord', 'Discord rejected the access token');
    if (!response.ok && response.status !== 404)
      throw new Error(`Discord ${path} answered ${response.status}`);
    return response;
  }
}
