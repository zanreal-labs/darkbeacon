import type { EveEntityCategory } from '@darkbeacon/shared';

export interface EveName {
  id: number;
  name: string;
  /** ESI's category; only characters, corporations and alliances are kept. */
  category: EveEntityCategory;
}

/**
 * Public and character-authenticated ESI lookups for the name pickers. Adapters honour ESI's
 * error limit and rate limits: when ESI must not be asked they throw `EsiUnavailableError`.
 */
export interface EveDirectory {
  /** `GET /characters/{character_id}/search` (scope esi-search.search_structures.v1); ids only. */
  search(input: {
    characterId: number;
    accessToken: string;
    category: EveEntityCategory;
    text: string;
  }): Promise<number[]>;
  /** `POST /universe/names` (up to 1000 ids per call; the adapter batches). Unknown ids are left out. */
  names(ids: readonly number[]): Promise<EveName[]>;
  /** `POST /universe/ids`: exact (case-insensitive) names to ids. */
  idsByName(names: readonly string[]): Promise<EveName[]>;
  /** Ticker of a corporation or alliance (`GET /corporations/{id}`, `GET /alliances/{id}`). */
  ticker(category: 'corporation' | 'alliance', id: number): Promise<string | null>;
}
