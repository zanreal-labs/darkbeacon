/**
 * What an OAuth round trip is for:
 * - `discord`: sign in with Discord;
 * - `discord-connect`: connect a Discord user to the signed-in account (`accountId`);
 * - `eve`: link an EVE character to the signed-in account (`accountId`);
 * - `eve-signin`: sign in with an EVE character (instances whose login method is EVE).
 */
export type PendingAuthKind = 'discord' | 'discord-connect' | 'eve' | 'eve-signin';

/**
 * State of an OAuth round trip. The HTTP edge keeps it (in an encrypted cookie) between the
 * redirect to the provider and the callback.
 */
export interface PendingAuth {
  kind: PendingAuthKind;
  state: string;
  codeVerifier: string;
  returnTo: string;
  /** The account a character or Discord user is being connected to. */
  accountId: string | null;
  expiresAt: number;
  /** An invite link's token brought to the sign-in (restricted sign-up). */
  invite?: string | null;
}
