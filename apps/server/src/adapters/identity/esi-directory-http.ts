import type { Clock } from '@darkbeacon/core';
import { EsiUnavailableError, type EveDirectory, type EveName } from '@darkbeacon/identity';
import type { EveEntityCategory } from '@darkbeacon/shared';
import type { FetchLike } from './oauth-http.js';

const ESI = 'https://esi.evetech.net';
/**
 * The compatibility date these routes are documented under in the live OpenAPI spec
 * (https://esi.evetech.net/meta/openapi.json; `x-compatibility-date: 2020-01-01` on search,
 * /universe/names, /universe/ids, /corporations/{id} and /alliances/{id}).
 */
const COMPATIBILITY_DATE = '2020-01-01';
/** Stop before ESI's error limit runs out (it bans an IP that hits it). */
const ERROR_FLOOR = 10;
const BACKOFF_MS = 5_000;
const NAMES_BATCH = 1000;

const CATEGORY_KEYS: Record<string, EveEntityCategory> = {
  characters: 'character',
  corporations: 'corporation',
  alliances: 'alliance',
};

/**
 * ESI for the name pickers. Every answer's `X-ESI-Error-Limit-*` headers are read; with fewer than
 * 10 errors left, or after a 420/429 (Retry-After) or a 5xx, no call is made until ESI says so and
 * callers get `EsiUnavailableError`.
 */
export class EsiDirectoryHttp implements EveDirectory {
  private pausedUntil = 0;

  constructor(
    private readonly clock: Clock,
    private readonly fetchFn: FetchLike = fetch,
    private readonly userAgent = 'Darkbeacon',
  ) {}

  async search(input: {
    characterId: number;
    accessToken: string;
    category: EveEntityCategory;
    text: string;
  }): Promise<number[]> {
    // One category per call: the pickers search one kind at a time, which also sidesteps how an
    // array query parameter is serialised.
    const query = new URLSearchParams({ categories: input.category, search: input.text, strict: 'false' });
    const response = await this.call(`/characters/${input.characterId}/search?${query}`, {
      headers: { authorization: `Bearer ${input.accessToken}` },
    });
    // A token without the search scope, or a character ESI no longer accepts: nothing found.
    if (response.status === 401 || response.status === 403) return [];
    await this.check(response, 'search');
    const body = (await response.json()) as Partial<Record<EveEntityCategory, number[]>>;
    return body[input.category] ?? [];
  }

  async names(ids: readonly number[]): Promise<EveName[]> {
    const result: EveName[] = [];
    for (let i = 0; i < ids.length; i += NAMES_BATCH) {
      result.push(...(await this.namesBatch(ids.slice(i, i + NAMES_BATCH))));
    }
    return result;
  }

  async idsByName(names: readonly string[]): Promise<EveName[]> {
    const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0 && n.length <= 100))];
    if (wanted.length === 0) return [];
    const response = await this.call('/universe/ids', { method: 'POST', body: JSON.stringify(wanted) });
    await this.check(response, 'universe/ids');
    const body = (await response.json()) as Record<string, Array<{ id: number; name: string }> | undefined>;
    return Object.entries(CATEGORY_KEYS).flatMap(([key, category]) =>
      (body[key] ?? []).map((e) => ({ id: e.id, name: e.name, category })),
    );
  }

  async ticker(category: 'corporation' | 'alliance', id: number): Promise<string | null> {
    const response = await this.call(`/${category === 'corporation' ? 'corporations' : 'alliances'}/${id}`);
    if (response.status === 404) return null;
    await this.check(response, category);
    const body = (await response.json()) as { ticker?: string };
    return body.ticker ?? null;
  }

  /** `/universe/names` answers 404 when any id is unknown, so a failing batch is split up. */
  private async namesBatch(ids: readonly number[]): Promise<EveName[]> {
    if (ids.length === 0) return [];
    const response = await this.call('/universe/names', { method: 'POST', body: JSON.stringify(ids) });
    if (response.status === 404) {
      if (ids.length === 1) return [];
      const half = Math.ceil(ids.length / 2);
      return [...(await this.namesBatch(ids.slice(0, half))), ...(await this.namesBatch(ids.slice(half)))];
    }
    await this.check(response, 'universe/names');
    const body = (await response.json()) as Array<{ id: number; name: string; category: string }>;
    return body.flatMap((e) =>
      e.category === 'character' || e.category === 'corporation' || e.category === 'alliance'
        ? [{ id: e.id, name: e.name, category: e.category }]
        : [],
    );
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const now = this.clock.now();
    if (now < this.pausedUntil) throw new EsiUnavailableError(this.pausedUntil);
    let response: Response;
    try {
      response = await this.fetchFn(`${ESI}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-compatibility-date': COMPATIBILITY_DATE,
          'user-agent': this.userAgent,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      this.pausedUntil = this.clock.now() + BACKOFF_MS;
      throw new EsiUnavailableError(this.pausedUntil);
    }
    const remain = Number(response.headers.get('x-esi-error-limit-remain'));
    const reset = Number(response.headers.get('x-esi-error-limit-reset'));
    if (response.headers.has('x-esi-error-limit-remain') && remain < ERROR_FLOOR) {
      this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + (reset || 60) * 1000);
    }
    if (response.status === 420 || response.status === 429) {
      const retry = Number(response.headers.get('retry-after')) || 60;
      this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + retry * 1000);
      throw new EsiUnavailableError(this.pausedUntil);
    }
    if (response.status >= 500) {
      this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + BACKOFF_MS);
      throw new EsiUnavailableError(this.pausedUntil);
    }
    return response;
  }

  private async check(response: Response, what: string): Promise<void> {
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(`ESI ${what} answered ${response.status}${body.error ? `: ${body.error}` : ''}`);
  }
}
