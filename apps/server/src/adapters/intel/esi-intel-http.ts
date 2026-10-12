import type { Clock } from '@darkbeacon/core';
import {
  esiHour,
  type ActivitySource,
  type NameResolver,
  type ResolvedName,
  type SourceResult,
  type SovereigntyClaim,
  type SovereigntySource,
} from '@darkbeacon/intel';
import { ESI_COMPATIBILITY_DATE } from '../tracking/http-esi-gateway.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** Stop before ESI's error limit runs out (it answers 420 to everything after that). */
const ERROR_LIMIT_RESERVE = 10;
/** Share of a rate-limit bucket left alone. */
const BUCKET_RESERVE = 0.1;
const MAX_BACKOFF = 5 * MINUTE;
const NAMES_BATCH = 1000;

export interface EsiPublicOptions {
  clock: Clock;
  /** Identifies the instance to CCP, e.g. `Darkbeacon/0.1.0 (+https://map.example.org)`. */
  userAgent: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

type Answer =
  { ok: true; response: Response; nextAt: number } | { ok: false; retryAt: number; reason: string };

/**
 * Unauthenticated ESI for intel (one client for every route it uses). Keeps ESI's rules: the
 * global error limit (`X-ESI-Error-Limit-*`, stops with 10 errors left, 420 waits `Retry-After`),
 * rate-limit groups (`X-Ratelimit-*`, a bucket below 10 % rests a tenth of its window, 429 waits
 * `Retry-After`), exponential backoff per route on 5xx and network errors (5 s doubling to 5 min),
 * `If-None-Match` with the last ETag and the next fetch at `Expires`.
 */
export class EsiPublicClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private blockedUntil = 0;
  private readonly groups = new Map<string, string>();
  private readonly buckets = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly etags = new Map<string, string>();

  constructor(private readonly options: EsiPublicOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://esi.evetech.net').replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  /** `key` names the route for backoff and buckets (`/universe/system_kills`). */
  async request(
    key: string,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; etag?: boolean } = {},
  ): Promise<Answer> {
    const now = this.options.clock.now();
    const group = this.groups.get(key);
    const waitUntil = Math.max(this.blockedUntil, group ? (this.buckets.get(group) ?? 0) : 0);
    if (waitUntil > now) return { ok: false, retryAt: waitUntil, reason: 'rate limited' };
    const etag = init.etag ? this.etags.get(path) : undefined;
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
          'x-compatibility-date': ESI_COMPATIBILITY_DATE,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(etag ? { 'if-none-match': etag } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(20 * SECOND),
      });
    } catch (error) {
      return this.failed(key, now, null, `request failed: ${String(error)}`);
    }
    const headers = response.headers;
    this.readLimits(key, headers, now);
    const retryAfter = integer(headers.get('retry-after'));
    if (response.ok || response.status === 304) {
      this.failures.delete(key);
      const tag = headers.get('etag');
      if (init.etag && tag) this.etags.set(path, tag);
      return { ok: true, response, nextAt: expiresAt(headers, now) };
    }
    if (response.status === 404) return { ok: true, response, nextAt: now + 5 * MINUTE };
    await response.body?.cancel();
    if (response.status === 420) {
      this.blockedUntil = Math.max(this.blockedUntil, now + (retryAfter ?? 60) * SECOND);
      return { ok: false, retryAt: this.blockedUntil, reason: 'error limited (420)' };
    }
    if (response.status === 429) {
      const until = now + (retryAfter ?? 60) * SECOND;
      this.buckets.set(this.groups.get(key) ?? key, until);
      return { ok: false, retryAt: until, reason: 'rate limited (429)' };
    }
    return this.failed(key, now, retryAfter, `HTTP ${response.status}`);
  }

  private failed(key: string, now: number, retryAfter: number | null, reason: string) {
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    const backoff = Math.min(5 * SECOND * 2 ** (count - 1), MAX_BACKOFF);
    return { ok: false as const, retryAt: now + Math.max(backoff, (retryAfter ?? 0) * SECOND), reason };
  }

  private readLimits(key: string, headers: Headers, now: number): void {
    const errorsLeft = integer(headers.get('x-esi-error-limit-remain'));
    const errorReset = integer(headers.get('x-esi-error-limit-reset'));
    if (errorsLeft !== null && errorReset !== null && errorsLeft <= ERROR_LIMIT_RESERVE) {
      this.blockedUntil = Math.max(this.blockedUntil, now + errorReset * SECOND);
    }
    const group = headers.get('x-ratelimit-group');
    const limit = /^(\d+)\/(\d+)([smh])$/.exec(headers.get('x-ratelimit-limit') ?? '');
    const remaining = integer(headers.get('x-ratelimit-remaining'));
    if (!group || !limit || remaining === null) return;
    this.groups.set(key, group);
    const windowMs = Number(limit[2]) * { s: SECOND, m: MINUTE, h: 60 * MINUTE }[limit[3] as 's' | 'm' | 'h'];
    if (remaining <= Number(limit[1]) * BUCKET_RESERVE) {
      this.buckets.set(group, Math.max(this.buckets.get(group) ?? 0, now + windowMs / 10));
    }
  }
}

function integer(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

/** `Expires` relative to the server's `Date` (clock skew does not matter), else `max-age`. */
export function expiresAt(headers: Headers, now: number): number {
  const expires = Date.parse(headers.get('expires') ?? '');
  if (!Number.isNaN(expires)) {
    const date = Date.parse(headers.get('date') ?? '');
    return Number.isNaN(date) ? expires : now + Math.max(0, expires - date);
  }
  const maxAge = /max-age=(\d+)/.exec(headers.get('cache-control') ?? '');
  return maxAge ? now + Number(maxAge[1]) * SECOND : now + 5 * MINUTE;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

/**
 * ESI's hourly figures (`GET /universe/system_kills`, `GET /universe/system_jumps`; public, cached
 * an hour, "within the last hour ending at the timestamp of the Last-Modified header", only
 * systems with something to count, no wormhole space for kills).
 */
export class EsiActivitySource implements ActivitySource {
  constructor(private readonly client: EsiPublicClient) {}

  async systemKills() {
    return this.hourly('/universe/system_kills', (row) => {
      const systemId = id(row.system_id);
      return systemId === null
        ? null
        : {
            systemId,
            shipKills: count(row.ship_kills),
            podKills: count(row.pod_kills),
            npcKills: count(row.npc_kills),
          };
    });
  }

  async systemJumps() {
    return this.hourly('/universe/system_jumps', (row) => {
      const systemId = id(row.system_id);
      return systemId === null ? null : { systemId, jumps: count(row.ship_jumps) };
    });
  }

  private async hourly<T>(
    path: string,
    parse: (row: Record<string, unknown>) => T | null,
  ): Promise<SourceResult<{ hour: number; rows: T[] } | null>> {
    const answer = await this.client.request(path, path, { etag: true });
    if (!answer.ok) return answer;
    const { response, nextAt } = answer;
    if (response.status === 304) return { ok: true, data: null, nextAt };
    if (response.status === 404) return { ok: false, retryAt: nextAt, reason: 'not found' };
    const body = (await response.json()) as unknown;
    const lastModified = Date.parse(response.headers.get('last-modified') ?? '');
    if (!Array.isArray(body) || Number.isNaN(lastModified))
      return { ok: false, retryAt: nextAt, reason: 'unexpected answer' };
    const rows = body.filter(isRecord).flatMap((row) => parse(row) ?? []);
    return { ok: true, data: { hour: esiHour(lastModified), rows }, nextAt };
  }
}

/**
 * Sovereignty claims from `GET /sovereignty/systems` (route version 2026-05-19; `/sovereignty/map`
 * is gone from compatibility date 2026-05-19 on). A claim is `{alliance: {alliance_id,
 * corporation_id, ...}}`, `{faction: {faction_id}}` or `{unclaimed: true}`; cached 5 minutes.
 */
export class EsiSovereigntySource implements SovereigntySource {
  constructor(private readonly client: EsiPublicClient) {}

  async claims(): Promise<SourceResult<Array<{ systemId: number; claim: SovereigntyClaim }> | null>> {
    const path = '/sovereignty/systems';
    const answer = await this.client.request(path, path, { etag: true });
    if (!answer.ok) return answer;
    const { response, nextAt } = answer;
    if (response.status === 304) return { ok: true, data: null, nextAt };
    if (response.status === 404) return { ok: false, retryAt: nextAt, reason: 'not found' };
    const pages = [await response.json()];
    const total = integer(response.headers.get('x-pages')) ?? 1;
    for (let page = 2; page <= Math.min(total, 50); page++) {
      const more = await this.client.request(path, `${path}?page=${page}`);
      if (!more.ok) return more;
      pages.push(await more.response.json());
    }
    const claims: Array<{ systemId: number; claim: SovereigntyClaim }> = [];
    for (const body of pages) {
      const systems = isRecord(body) && Array.isArray(body.solar_systems) ? body.solar_systems : [];
      for (const entry of systems.filter(isRecord)) {
        const systemId = id(entry.solar_system_id);
        const claim = isRecord(entry.claim) ? entry.claim : null;
        if (systemId === null || !claim) continue;
        if (isRecord(claim.alliance) && id(claim.alliance.alliance_id) !== null) {
          claims.push({
            systemId,
            claim: {
              kind: 'alliance',
              allianceId: id(claim.alliance.alliance_id)!,
              corporationId: id(claim.alliance.corporation_id),
            },
          });
        } else if (isRecord(claim.faction) && id(claim.faction.faction_id) !== null) {
          claims.push({ systemId, claim: { kind: 'faction', factionId: id(claim.faction.faction_id)! } });
        }
      }
    }
    return { ok: true, data: claims, nextAt };
  }
}

/**
 * Names from `POST /universe/names` (up to 1000 ids; a 404 when any id is unknown, so a failing
 * batch is split in halves) and tickers from `GET /alliances/{id}` and `GET /corporations/{id}`.
 */
export class EsiNameResolver implements NameResolver {
  constructor(private readonly client: EsiPublicClient) {}

  async names(ids: readonly number[]): Promise<ResolvedName[]> {
    const unique = [...new Set(ids)].filter((i) => Number.isInteger(i) && i > 0);
    const result: ResolvedName[] = [];
    for (let i = 0; i < unique.length; i += NAMES_BATCH)
      result.push(...(await this.batch(unique.slice(i, i + NAMES_BATCH))));
    return result;
  }

  private async batch(ids: number[]): Promise<ResolvedName[]> {
    if (ids.length === 0) return [];
    const answer = await this.client.request('/universe/names', '/universe/names', {
      method: 'POST',
      body: ids,
    });
    if (!answer.ok) throw new Error(`ESI names: ${answer.reason}`);
    if (answer.response.status === 404) {
      await answer.response.body?.cancel();
      if (ids.length === 1) return [];
      const half = Math.ceil(ids.length / 2);
      return [...(await this.batch(ids.slice(0, half))), ...(await this.batch(ids.slice(half)))];
    }
    const body = (await answer.response.json()) as unknown;
    return (Array.isArray(body) ? body : []).filter(isRecord).flatMap((row) => {
      const rowId = id(row.id);
      return rowId !== null && typeof row.name === 'string' && typeof row.category === 'string'
        ? [{ id: rowId, name: row.name, category: row.category }]
        : [];
    });
  }

  async ticker(category: 'corporation' | 'alliance', entityId: number): Promise<string | null> {
    const plural = category === 'corporation' ? 'corporations' : 'alliances';
    const answer = await this.client.request(`/${plural}/{id}`, `/${plural}/${entityId}`);
    if (!answer.ok) throw new Error(`ESI ${category}: ${answer.reason}`);
    if (answer.response.status === 404) {
      await answer.response.body?.cancel();
      return null;
    }
    const body = (await answer.response.json()) as { ticker?: unknown };
    return typeof body.ticker === 'string' && body.ticker ? body.ticker : null;
  }
}
