import type { InstanceRole } from '@darkbeacon/core';

/** A person, identified by their Discord user (dev-login accounts have no Discord id). */
export interface Account {
  id: string;
  discordId: string | null;
  name: string;
  avatarUrl: string | null;
  instanceRole: InstanceRole;
  /** Character the account acts as by default; may point at a character unlinked since. */
  mainCharacterId?: number | null;
  /** The map `/` opens for this account; may point at a map deleted or closed to it since. */
  defaultMapId?: string | null;
  /** Maps the account opened, most recent first (at most `RECENT_MAPS`). */
  recentMapIds?: string[];
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  /** Set while an instance admin has disabled the account: no sign-in, no sessions, no keys, no maps. */
  disabledAt?: number | null;
  disabledReason?: string | null;
}

/** An invite link to sign up while sign-up is restricted; only the token's hash is kept. */
export interface Invite {
  id: string;
  tokenHash: string;
  note: string | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  revokedAt: number | null;
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

/** A role an account holds on a Discord guild. */
export interface GuildRole {
  guildId: string;
  roleId: string;
}

/** The Discord grant of an account, kept to re-read guild roles. Tokens are encrypted at rest. */
export interface DiscordLink {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Last known roles on the guilds the instance cares about. */
  guildRoles: GuildRole[];
  /** When `guildRoles` was last read from Discord, null when never. */
  rolesCheckedAt: number | null;
}

/** Plain tokens; the repository adapter encrypts them at rest. */
export interface CharacterTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}
