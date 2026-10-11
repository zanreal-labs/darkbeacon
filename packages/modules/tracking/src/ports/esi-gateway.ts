/**
 * One ESI call. The gateway honours ETag, Expires/Cache-Control, the X-Ratelimit-* buckets, the
 * error limit and Retry-After itself; it never throws. When it cannot or must not answer it
 * says when to ask again.
 */
export type EsiResult<T> =
  | {
      ok: true;
      /** Null when the server answered 304 Not Modified. */
      data: T | null;
      etag: string | null;
      /** From `Expires` (or `Cache-Control: max-age`); do not poll again before this (epoch ms). */
      expiresAt: number;
    }
  | { ok: false; retryAt: number; reason: string };

export interface EsiLocation {
  solarSystemId: number;
  stationId: number | null;
  structureId: number | null;
}

export interface EsiShip {
  shipTypeId: number;
  shipItemId: number;
  shipName: string;
}

export interface EsiOnline {
  online: boolean;
  lastLogin: number | null;
}

export interface EsiGateway {
  location(characterId: number, accessToken: string, etag?: string): Promise<EsiResult<EsiLocation>>;
  ship(characterId: number, accessToken: string, etag?: string): Promise<EsiResult<EsiShip>>;
  online(characterId: number, accessToken: string, etag?: string): Promise<EsiResult<EsiOnline>>;
}
