/**
 * Thrown by provider adapters when Discord or EVE SSO rejects our credentials (revoked grant,
 * invalid code, bad token signature). Network failures stay plain errors.
 */
/** ESI must not be asked right now (error limit, rate limit, outage); `retryAt` is epoch ms. */
export class EsiUnavailableError extends Error {
  constructor(readonly retryAt: number) {
    super('EVE Online is not answering right now; try again in a moment');
    this.name = 'EsiUnavailableError';
  }
}

export class ExternalAuthError extends Error {
  constructor(
    readonly provider: 'discord' | 'eve',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalAuthError';
  }
}
