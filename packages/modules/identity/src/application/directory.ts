import { requireAccount, type Actor, type Clock } from '@darkbeacon/core';
import type { EveEntityCategory, EveEntityDto, EveSearchResultDto } from '@darkbeacon/shared';
import type { EveDirectory, EveName } from '../ports/eve-directory.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { CharacterService } from './characters.js';

export interface EveDirectoryDeps {
  directory: EveDirectory;
  characters: CharacterService;
  accounts: AccountRepository;
  clock: Clock;
}

/** ESI caches search for an hour; names and tickers change rarely (renames, ticker changes). */
const SEARCH_TTL_MS = 60 * 60 * 1000;
const NAME_TTL_MS = 24 * 60 * 60 * 1000;
/** ESI's minimum search length. */
export const ESI_SEARCH_MIN = 3;
const RESULTS = 20;
const CACHE_MAX = 5_000;

interface Cached<T> {
  value: T;
  at: number;
}

/**
 * Names of EVE characters, corporations and alliances for the pickers: ESI search through one
 * of the caller's characters (scope esi-search.search_structures.v1), an exact-name fallback
 * through `POST /universe/ids`, and ids resolved to names and tickers, all cached in memory.
 */
export class EveDirectoryService {
  private readonly searches = new Map<string, Cached<number[]>>();
  private readonly names = new Map<number, Cached<EveName | null>>();
  private readonly tickers = new Map<number, Cached<string | null>>();

  constructor(private readonly deps: EveDirectoryDeps) {}

  async search(actor: Actor | null, category: EveEntityCategory, query: string): Promise<EveSearchResultDto> {
    const caller = requireAccount(actor);
    const text = query.trim();
    const account = await this.deps.accounts.findById(caller.id);
    const { token, characters } = await this.deps.characters.searchToken(
      caller.id,
      account?.mainCharacterId ?? null,
    );
    let ids: number[] = [];
    let mode: EveSearchResultDto['mode'] = 'exact';
    if (token && text.length >= ESI_SEARCH_MIN) {
      mode = 'search';
      const key = `${category}:${text.toLowerCase()}`;
      const hit = this.fresh(this.searches, key, SEARCH_TTL_MS);
      if (hit) {
        ids = hit;
      } else {
        ids = await this.deps.directory.search({ ...token, category, text });
        this.remember(this.searches, key, ids);
      }
    }
    // An exact name always counts, also when search is not possible or missed it.
    const exact = (await this.deps.directory.idsByName([text])).filter(
      (n) => n.category === category && n.name.toLowerCase() === text.toLowerCase(),
    );
    for (const name of exact) this.remember(this.names, name.id, name);
    const wanted = [...new Set([...exact.map((n) => n.id), ...ids.slice(0, RESULTS)])];
    const entities = (await this.entities(wanted)).filter((e) => e.category === category);
    return {
      results: rank(entities, text).slice(0, RESULTS),
      mode,
      relinkToSearch: characters > 0 && token === null,
    };
  }

  /** Names and tickers of these ids; unknown ids (and other categories) are left out. */
  async entities(ids: readonly number[]): Promise<EveEntityDto[]> {
    const unique = [...new Set(ids)];
    const missing = unique.filter((id) => this.fresh(this.names, id, NAME_TTL_MS) === undefined);
    if (missing.length > 0) {
      const found = await this.deps.directory.names(missing);
      for (const id of missing) this.remember(this.names, id, null);
      for (const name of found) this.remember(this.names, name.id, name);
    }
    const result: EveEntityDto[] = [];
    for (const id of unique) {
      const name = this.fresh(this.names, id, NAME_TTL_MS);
      if (!name) continue;
      const ticker = name.category === 'character' ? null : await this.ticker(name.category, id);
      result.push({ id, name: name.name, category: name.category, ticker });
    }
    return result;
  }

  private async ticker(category: 'corporation' | 'alliance', id: number): Promise<string | null> {
    const hit = this.fresh(this.tickers, id, NAME_TTL_MS);
    if (hit !== undefined) return hit;
    const ticker = await this.deps.directory.ticker(category, id).catch(() => null);
    this.remember(this.tickers, id, ticker);
    return ticker;
  }

  private fresh<K, T>(cache: Map<K, Cached<T>>, key: K, ttl: number): T | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (this.deps.clock.now() - hit.at > ttl) {
      cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  private remember<K, T>(cache: Map<K, Cached<T>>, key: K, value: T): void {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as K);
    cache.set(key, { value, at: this.deps.clock.now() });
  }
}

/** Exact names first, then names starting with the text, then the rest; alphabetical within. */
export function rank(entities: EveEntityDto[], text: string): EveEntityDto[] {
  const t = text.toLowerCase();
  const score = (e: EveEntityDto) => {
    const name = e.name.toLowerCase();
    const ticker = e.ticker?.toLowerCase();
    if (name === t || ticker === t) return 0;
    if (name.startsWith(t)) return 1;
    return 2;
  };
  return [...entities].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
