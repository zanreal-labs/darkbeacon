import type { Clock } from '@darkbeacon/core';
import type { EsiGateway, EsiLocation, EsiOnline, EsiResult, EsiShip } from '@darkbeacon/tracking';

/** ESI version contract (`X-Compatibility-Date`); see https://esi.evetech.net/meta/compatibility-dates. */
export const ESI_COMPATIBILITY_DATE = '2026-08-18';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** Stop before the global error limit runs out instead of hitting 420s. */
const ERROR_LIMIT_RESERVE = 10;
/** Share of a rate-limit bucket kept in reserve; below it the bucket is left alone for a while. */
const BUCKET_RESERVE = 0.1;
const MAX_BACKOFF = 5 * MINUTE;
/** 401/403: the token or its scopes are wrong; asking again soon will not help. */
const AUTH_RETRY = 5 * MINUTE;

type Route = 'location' | 'ship' | 'online';

export interface HttpEsiGatewayOptions {
  clock: Clock;
  /** Identifies the instance to CCP, e.g. `Darkbeacon/0.1.0 (+https://map.example.org)`. */
  userAgent: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * ESI over HTTP for the tracking poller. Sends `If-None-Match`, reads `Expires`, keeps
 * the floating-window buckets (`X-Ratelimit-*`, one per route group and character) and the
 * global error limit (`X-ESI-Error-Limit-*`) apart from each other, honours `Retry-After`,
 * and backs off exponentially per character on server and network errors.
 */
export class HttpEsiGateway implements EsiGateway {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  /** Every request waits until then (error limit reached or a 420). */
  private blockedUntil = 0;
  /** `<group>:<characterId>` -> no requests before (epoch ms). */
  private readonly buckets = new Map<string, number>();
  /** Rate-limit group of each route: from the OpenAPI spec, updated from response headers. */
  private readonly groups = new Map<Route, string>([
    ['location', 'char-location'],
    ['ship', 'char-location'],
    ['online', 'char-location'],
  ]);
  private readonly failures = new Map<number, number>();

  constructor(private readonly options: HttpEsiGatewayOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://esi.evetech.net').replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  location(characterId: number, accessToken: string, etag?: string): Promise<EsiResult<EsiLocation>> {
    return this.get(characterId, accessToken, 'location', etag, (body) => ({
      solarSystemId: Number(body.solar_system_id),
      stationId: body.station_id == null ? null : Number(body.station_id),
      structureId: body.structure_id == null ? null : Number(body.structure_id),
    }));
  }

  ship(characterId: number, accessToken: string, etag?: string): Promise<EsiResult<EsiShip>> {
    return this.get(characterId, accessToken, 'ship', etag, (body) => ({
      shipTypeId: Number(body.ship_type_id),
      shipItemId: Number(body.ship_item_id),
      shipName: String(body.ship_name ?? ''),
    }));
  }

  online(characterId: number, accessToken: string, etag?: string): Promise<EsiResult<EsiOnline>> {
    return this.get(characterId, accessToken, 'online', etag, (body) => ({
      online: body.online === true,
      lastLogin: typeof body.last_login === 'string' ? Date.parse(body.last_login) : null,
    }));
  }

  private async get<T>(
    characterId: number,
    accessToken: string,
    route: Route,
    etag: string | undefined,
    parse: (body: Record<string, unknown>) => T,
  ): Promise<EsiResult<T>> {
    const now = this.options.clock.now();
    const waitUntil = Math.max(this.blockedUntil, this.buckets.get(this.bucketKey(route, characterId)) ?? 0);
    if (waitUntil > now) return { ok: false, retryAt: waitUntil, reason: 'rate limited' };

    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/characters/${characterId}/${route}`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          'user-agent': this.options.userAgent,
          'x-compatibility-date': ESI_COMPATIBILITY_DATE,
          ...(etag ? { 'if-none-match': etag } : {}),
        },
        signal: AbortSignal.timeout(10 * SECOND),
      });
    } catch (error) {
      return this.failed(characterId, now, null, `request failed: ${String(error)}`);
    }

    const headers = response.headers;
    this.readLimits(characterId, route, headers, now);
    const retryAfter = seconds(headers.get('retry-after'));

    if (response.status === 304 || response.ok) {
      const data = response.status === 304 ? null : parse((await response.json()) as Record<string, unknown>);
      this.failures.delete(characterId);
      return {
        ok: true,
        data,
        etag: headers.get('etag') ?? etag ?? null,
        expiresAt: expiresAt(headers, now),
      };
    }
    await response.body?.cancel();

    if (response.status === 420) {
      this.blockedUntil = Math.max(this.blockedUntil, now + (retryAfter ?? 60) * SECOND);
      return { ok: false, retryAt: this.blockedUntil, reason: 'error limited (420)' };
    }
    if (response.status === 429) {
      // Retry-After is authoritative here, even over the reserve rule in readLimits.
      const until = now + (retryAfter ?? 60) * SECOND;
      this.buckets.set(this.bucketKey(route, characterId), until);
      return { ok: false, retryAt: until, reason: 'rate limited (429)' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, retryAt: now + AUTH_RETRY, reason: `HTTP ${response.status}` };
    }
    return this.failed(characterId, now, retryAfter, `HTTP ${response.status}`);
  }

  /** Exponential backoff per character: 5 s, 10 s, 20 s ... up to 5 minutes. */
  private failed(characterId: number, now: number, retryAfter: number | null, reason: string) {
    const count = (this.failures.get(characterId) ?? 0) + 1;
    this.failures.set(characterId, count);
    const backoff = Math.min(5 * SECOND * 2 ** (count - 1), MAX_BACKOFF);
    return { ok: false as const, retryAt: now + Math.max(backoff, (retryAfter ?? 0) * SECOND), reason };
  }

  private bucketKey(route: Route, characterId: number): string {
    return `${this.groups.get(route) ?? route}:${characterId}`;
  }

  private blockBucket(key: string, until: number): void {
    this.buckets.set(key, Math.max(this.buckets.get(key) ?? 0, until));
  }

  private readLimits(characterId: number, route: Route, headers: Headers, now: number): void {
    const errorsLeft = seconds(headers.get('x-esi-error-limit-remain'));
    const errorReset = seconds(headers.get('x-esi-error-limit-reset'));
    if (errorsLeft !== null && errorReset !== null && errorsLeft <= ERROR_LIMIT_RESERVE) {
      this.blockedUntil = Math.max(this.blockedUntil, now + errorReset * SECOND);
    }

    const group = headers.get('x-ratelimit-group');
    const limit = /^(\d+)\/(\d+)([smh])$/.exec(headers.get('x-ratelimit-limit') ?? '');
    const remaining = seconds(headers.get('x-ratelimit-remaining'));
    if (!group || !limit || remaining === null) return;
    this.groups.set(route, group);
    const windowMs = Number(limit[2]) * { s: SECOND, m: MINUTE, h: 60 * MINUTE }[limit[3] as 's' | 'm' | 'h'];
    // Tokens come back one window after they were spent; a tenth of the window lets some return.
    if (remaining <= Number(limit[1]) * BUCKET_RESERVE) {
      this.blockBucket(this.bucketKey(route, characterId), now + windowMs / 10);
    }
  }
}

/** Integer header value (seconds or counts); null when absent or malformed. */
function seconds(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

/** `Expires` relative to the server's `Date` (so clock skew does not matter), else `max-age`. */
function expiresAt(headers: Headers, now: number): number {
  const expires = Date.parse(headers.get('expires') ?? '');
  if (!Number.isNaN(expires)) {
    const date = Date.parse(headers.get('date') ?? '');
    return Number.isNaN(date) ? expires : now + Math.max(0, expires - date);
  }
  const maxAge = /max-age=(\d+)/.exec(headers.get('cache-control') ?? '');
  return maxAge ? now + Number(maxAge[1]) * SECOND : now;
}
