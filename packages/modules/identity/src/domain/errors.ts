/**
 * Thrown by provider adapters when Discord or EVE SSO rejects our credentials (revoked grant,
 * invalid code, bad token signature). Network failures stay plain errors.
 */
export class ExternalAuthError extends Error {
  constructor(
    readonly provider: 'discord' | 'eve',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalAuthError';
  }
}
