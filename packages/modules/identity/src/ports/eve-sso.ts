/** Verified claims of an EVE SSO access token (JWT checked against the advertised JWKS, iss, aud, exp). */
export interface EveIdentity {
  characterId: number;
  characterName: string;
  ownerHash: string;
  scopes: string[];
}

export interface EveTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  identity: EveIdentity;
}

/**
 * EVE SSO v2: authorization code + PKCE (S256). Adapters throw `ExternalAuthError` when EVE
 * rejects a code or refresh token, or the access token fails verification.
 */
export interface EveSso {
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
  }): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<EveTokenSet>;
  refresh(refreshToken: string): Promise<EveTokenSet>;
  /** Public affiliation (corporation, alliance) of a character. */
  affiliation(characterId: number): Promise<{ corporationId: number; allianceId: number | null }>;
}
