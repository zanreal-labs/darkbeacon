import type { InstanceRole } from '@wormwright/core';

/** A person, identified by their Discord user (dev-login accounts have no Discord id). */
export interface Account {
  id: string;
  discordId: string | null;
  name: string;
  avatarUrl: string | null;
  instanceRole: InstanceRole;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
}

/** Server-side session behind the httpOnly cookie. `id` is a hash of the cookie token. */
export interface Session {
  id: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent: string | null;
}

/** An EVE character linked to exactly one account. */
export interface LinkedCharacter {
  id: number;
  accountId: string;
  name: string;
  corporationId: number;
  allianceId: number | null;
  /** EVE SSO owner hash; changes when the character is transferred to another EVE account. */
  ownerHash: string;
  tokenValid: boolean;
  linkedAt: number;
  updatedAt: number;
}

/** Plain tokens; the repository adapter encrypts them at rest. */
export interface CharacterTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}
