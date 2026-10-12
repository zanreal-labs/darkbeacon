import { DomainError } from '@darkbeacon/core';

/** Why reading a Wanderer instance failed, in terms people can act on. */
export type SourceFailure =
  /** 401/403: the key is wrong, revoked, or not the map's. */
  | 'auth'
  /** 404: no such map (or no such API on that instance). */
  | 'not_found'
  /** 429 that did not clear after waiting. */
  | 'rate_limited'
  /** 5xx, timeouts, connection errors. */
  | 'unavailable'
  /** Refused before asking: private address, bad certificate, redirect. */
  | 'refused'
  /** The answer was not what Wanderer's API sends. */
  | 'invalid';

/** A failure to read the source. A validation error at the HTTP edge (400) with its reason. */
export class SourceError extends DomainError {
  constructor(
    readonly failure: SourceFailure,
    message: string,
  ) {
    super('validation', message, { failure });
    this.name = 'SourceError';
  }
}
