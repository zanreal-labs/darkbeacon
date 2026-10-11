/** One ESI response with the caching headers the poller must honour. */
export interface EsiResult<T> {
  /** Null when the server answered 304 Not Modified. */
  data: T | null;
  etag: string | null;
  /** From `Expires`; do not poll again before this (epoch ms). */
  expiresAt: number;
}

/** Remaining budget from the `X-Ratelimit-*` headers of the last response. */
export interface EsiRateLimit {
  remaining: number | null;
  resetAt: number | null;
}

export interface EsiGateway {
  location(
    characterId: number,
    accessToken: string,
    etag?: string,
  ): Promise<EsiResult<{ solarSystemId: number; stationId: number | null; structureId: number | null }>>;
  ship(
    characterId: number,
    accessToken: string,
    etag?: string,
  ): Promise<EsiResult<{ shipTypeId: number; shipItemId: number; shipName: string }>>;
  online(
    characterId: number,
    accessToken: string,
    etag?: string,
  ): Promise<EsiResult<{ online: boolean; lastLogin: number | null }>>;
  rateLimit(): EsiRateLimit;
}
