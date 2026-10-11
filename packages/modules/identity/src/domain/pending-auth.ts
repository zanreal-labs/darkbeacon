/**
 * State of an OAuth round trip. The HTTP edge keeps it (in an encrypted cookie) between the
 * redirect to the provider and the callback.
 */
export interface PendingAuth {
  kind: 'discord' | 'eve';
  state: string;
  codeVerifier: string;
  returnTo: string;
  /** The account a character is being linked to (EVE only). */
  accountId: string | null;
  expiresAt: number;
}
