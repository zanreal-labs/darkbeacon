import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { Clock } from '@darkbeacon/core';
import { ExternalAuthError, type EveIdentity, type EveSso, type EveTokenSet } from '@darkbeacon/identity';
import { requestToken, type FetchLike, type OAuthClient } from './oauth-http.js';

export const EVE_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server';
const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
const ESI = 'https://esi.evetech.net';
/** EVE documents both forms of the issuer; accept those and nothing else. */
const ISSUERS = new Set([
  'https://login.eveonline.com',
  'https://login.eveonline.com/',
  'login.eveonline.com',
]);
const EVE_AUDIENCE = 'EVE Online';
const KEYS_TTL_MS = 60 * 60 * 1000;

interface Metadata {
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

/**
 * EVE SSO v2: authorization code with PKCE (S256) and confidential client authentication.
 * Access tokens are JWTs; they are verified against the JWKS advertised in the metadata
 * document, and their issuer, audience and expiry are checked.
 */
export class EveSsoHttp implements EveSso {
  private metadata: { value: Metadata; at: number } | null = null;
  private keys: { value: Jwk[]; at: number } | null = null;

  constructor(
    private readonly client: OAuthClient,
    private readonly clock: Clock,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
  }): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.client.clientId,
      redirect_uri: input.redirectUri,
      scope: input.scopes.join(' '),
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE_URL}?${params}`;
  }

  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<EveTokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
    });
  }

  refresh(refreshToken: string): Promise<EveTokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async affiliation(characterId: number): Promise<{ corporationId: number; allianceId: number | null }> {
    const response = await this.fetchFn(`${ESI}/characters/affiliation`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-compatibility-date': '2020-01-01',
      },
      body: JSON.stringify([characterId]),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`ESI affiliation answered ${response.status}`);
    const rows = (await response.json()) as Array<{
      character_id: number;
      corporation_id: number;
      alliance_id?: number;
    }>;
    const row = rows.find((r) => r.character_id === characterId);
    if (!row) throw new Error(`ESI has no affiliation for character ${characterId}`);
    return { corporationId: row.corporation_id, allianceId: row.alliance_id ?? null };
  }

  /** Verifies an EVE SSO access token and returns its claims. Throws ExternalAuthError when invalid. */
  async verify(accessToken: string): Promise<EveIdentity> {
    const parts = accessToken.split('.');
    if (parts.length !== 3) throw invalid('malformed token');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
    if (header.alg !== 'RS256' && header.alg !== 'ES256')
      throw invalid(`unsupported algorithm ${header.alg}`);

    const key = await this.key(header.kid, header.alg);
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`);
    const signature = Buffer.from(encodedSignature, 'base64url');
    const valid =
      header.alg === 'RS256'
        ? verify('sha256', signed, key, signature)
        : verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, signature);
    if (!valid) throw invalid('bad signature');

    const claims = decodeJson<{
      iss?: string;
      aud?: string | string[];
      exp?: number;
      sub?: string;
      name?: string;
      owner?: string;
      scp?: string | string[];
    }>(encodedPayload);
    if (!claims.iss || !ISSUERS.has(claims.iss)) throw invalid('unexpected issuer');
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(this.client.clientId) || !audience.includes(EVE_AUDIENCE)) {
      throw invalid('unexpected audience');
    }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= this.clock.now())
      throw invalid('token expired');
    const match = /^CHARACTER:EVE:(\d+)$/.exec(claims.sub ?? '');
    if (!match || !claims.name || !claims.owner) throw invalid('missing character claims');
    const scopes = claims.scp === undefined ? [] : Array.isArray(claims.scp) ? claims.scp : [claims.scp];
    return { characterId: Number(match[1]), characterName: claims.name, ownerHash: claims.owner, scopes };
  }

  private async token(form: Record<string, string>): Promise<EveTokenSet> {
    const { token_endpoint } = await this.loadMetadata();
    const token = await requestToken(this.fetchFn, 'eve', token_endpoint, this.client, form);
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: this.clock.now() + token.expires_in * 1000,
      identity: await this.verify(token.access_token),
    };
  }

  private async loadMetadata(): Promise<Metadata> {
    if (this.metadata && this.clock.now() - this.metadata.at < KEYS_TTL_MS) return this.metadata.value;
    const value = await this.getJson<Metadata>(EVE_METADATA_URL);
    if (!value.token_endpoint || !value.jwks_uri) throw new Error('EVE SSO metadata is incomplete');
    this.metadata = { value, at: this.clock.now() };
    return value;
  }

  /** The signing key for `kid`; the key set is re-read once when the kid is unknown (rotation). */
  private async key(kid: string | undefined, alg: string): Promise<KeyObject> {
    const find = (keys: Jwk[]) => keys.find((k) => (kid ? k.kid === kid : k.alg === alg));
    let jwk = this.keys && this.clock.now() - this.keys.at < KEYS_TTL_MS ? find(this.keys.value) : undefined;
    if (!jwk) {
      const { jwks_uri } = await this.loadMetadata();
      const { keys } = await this.getJson<{ keys: Jwk[] }>(jwks_uri);
      this.keys = { value: keys, at: this.clock.now() };
      jwk = find(keys);
    }
    if (!jwk) throw invalid('unknown signing key');
    return createPublicKey({ key: jwk, format: 'jwk' });
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return (await response.json()) as T;
  }
}

function invalid(reason: string): ExternalAuthError {
  return new ExternalAuthError('eve', `EVE SSO token rejected: ${reason}`);
}

function decodeJson<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    throw invalid('malformed token');
  }
}
