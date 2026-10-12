import type { InstanceRole } from '@darkbeacon/core';
import type { AuthorizationCode, OAuthClient, OAuthGrant, OAuthToken, TokenKind } from '../domain/oauth.js';

export type { Clock, EventLog, MapAccess, UnitOfWork } from '@darkbeacon/core';

export interface OAuthStore {
  findClient(id: string): Promise<OAuthClient | null>;
  saveClient(client: OAuthClient): Promise<void>;
  insertGrant(grant: OAuthGrant): Promise<void>;
  updateGrant(grant: OAuthGrant): Promise<void>;
  findGrant(id: string): Promise<OAuthGrant | null>;
  listGrants(accountId: string): Promise<OAuthGrant[]>;
  touchGrant(id: string, at: number, ip: string | null): Promise<void>;
  insertCode(code: AuthorizationCode): Promise<void>;
  findCode(lookup: string): Promise<AuthorizationCode | null>;
  /** Marks a code used; false when it was used already (a race or a replay). */
  useCode(lookup: string, at: number): Promise<boolean>;
  insertToken(token: OAuthToken): Promise<void>;
  findToken(lookup: string, kind: TokenKind): Promise<OAuthToken | null>;
  /** Marks a refresh token used; false when it was used already. */
  useToken(lookup: string, at: number): Promise<boolean>;
  /** Drops expired codes and tokens. */
  prune(before: number): Promise<number>;
}

/** Randomness and hashing (node:crypto in the server). */
export interface OAuthSecrets {
  random(length: number): string;
  /** Keyed hash (HMAC with a pepper) of a secret, for storage. */
  hash(secret: string): string;
  equals(a: string, b: string): boolean;
  /** base64url(SHA-256(verifier)): the PKCE S256 transform. */
  s256(verifier: string): string;
}

/** A Client ID Metadata Document, fetched from its URL (only public HTTPS addresses). */
export interface ClientMetadataFetcher {
  fetch(url: string): Promise<unknown>;
}

/** Provided by identity: an account as it is now. */
export interface OAuthAccounts {
  find(accountId: string): Promise<{ id: string; name: string; instanceRole: InstanceRole } | null>;
}

/** Provided by mapping: map names for the approvals list. */
export interface OAuthMapNames {
  describe(mapIds: readonly string[]): Promise<Array<{ id: string; name: string; slug: string }>>;
}
