export interface DiscordProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export interface DiscordGrant {
  profile: DiscordProfile;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Discord OAuth2 with scopes `identify guilds guilds.members.read`. Adapters throw
 * `ExternalAuthError` when Discord rejects a code or token.
 */
export interface IdentityProvider {
  authorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier?: string }): Promise<DiscordGrant>;
  refresh(refreshToken: string): Promise<DiscordGrant>;
  /** Role ids of the user on a guild, or null when not a member. */
  guildRoles(accessToken: string, guildId: string): Promise<string[] | null>;
}
