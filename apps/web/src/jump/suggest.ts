import { searchSystems, type StarModel } from './model';

/** Why a system is offered before anything is typed. */
export type SuggestionWhy =
  | { kind: 'character'; names: readonly string[]; online: boolean }
  | { kind: 'exit' }
  | { kind: 'map' }
  | { kind: 'recent' };

export interface Suggestion {
  /** Index into the star model. */
  index: number;
  why: SuggestionWhy;
}

/** One of my characters in known space (a system of the star model). */
export interface CharacterPlace {
  system: number;
  name: string;
  online: boolean;
}

/** What the pilot has on hand: their characters, the map's exits and systems, recent picks. */
export interface SuggestionSources {
  characters: readonly CharacterPlace[];
  /** Known-space systems the chain reaches through a wormhole. */
  exits: readonly number[];
  /** Known-space systems on the map. */
  mapSystems: readonly number[];
  /** Systems picked here before, most recent first. */
  recent: readonly number[];
}

export type End = 'origin' | 'destination';

/**
 * The systems offered for one end of the route, best first, each once. A start is usually where a
 * character sits: characters online, the chain's exits, characters offline, recent picks, then the
 * rest of the map; a character in a system says so even where the system came earlier as an exit.
 * A destination is usually on the map: exits, the map's systems, characters, recent picks (each
 * under its first reason). The system at the other end is left out.
 */
export function suggestionsFor(
  end: End,
  sources: SuggestionSources,
  other: number | null = null,
): Suggestion[] {
  const characters = groupCharacters(sources.characters);
  const online = characters.filter((s) => s.why.kind === 'character' && s.why.online);
  const offline = characters.filter((s) => s.why.kind === 'character' && !s.why.online);
  const exits = sources.exits.map((index): Suggestion => ({ index, why: { kind: 'exit' } }));
  const map = sources.mapSystems.map((index): Suggestion => ({ index, why: { kind: 'map' } }));
  const recent = sources.recent.map((index): Suggestion => ({ index, why: { kind: 'recent' } }));
  const ordered =
    end === 'origin'
      ? [...online, ...exits, ...offline, ...recent, ...map]
      : [...exits, ...map, ...online, ...offline, ...recent];
  const at = new Map<number, number>();
  const out: Suggestion[] = [];
  for (const s of ordered) {
    if (s.index === other) continue;
    const before = at.get(s.index);
    if (before === undefined) {
      at.set(s.index, out.length);
      out.push(s);
    } else if (end === 'origin' && s.why.kind === 'character' && out[before]!.why.kind !== 'character') {
      out[before] = { index: s.index, why: s.why };
    }
  }
  return out;
}

/** Characters sharing a system become one suggestion; online when any of them is. */
function groupCharacters(characters: readonly CharacterPlace[]): Suggestion[] {
  const bySystem = new Map<number, { names: string[]; online: boolean }>();
  for (const c of characters) {
    const entry = bySystem.get(c.system);
    if (entry) {
      entry.names.push(c.name);
      entry.online ||= c.online;
    } else bySystem.set(c.system, { names: [c.name], online: c.online });
  }
  return [...bySystem].map(([index, { names, online }]) => ({
    index,
    why: { kind: 'character', names, online },
  }));
}

/** At most this many suggestions show before anything is typed (the list scrolls). */
export const SUGGESTED = 12;

export interface Ranked {
  index: number;
  /** Null for a plain search result. */
  why: SuggestionWhy | null;
}

/**
 * The picker's list: with no text, the suggestions; with text, the suggestions whose name matches
 * (prefix matches first) and then the rest of known space by name, without repeats.
 */
export function rankSystems(
  model: StarModel,
  text: string,
  suggestions: readonly Suggestion[],
  limit = 8,
): Ranked[] {
  const q = text.trim().toLowerCase();
  if (!q) return suggestions.slice(0, SUGGESTED);
  const prefix: Ranked[] = [];
  const inside: Ranked[] = [];
  for (const s of suggestions) {
    const key = model.keys[s.index]!;
    if (key.startsWith(q)) prefix.push(s);
    else if (key.includes(q)) inside.push(s);
  }
  const mine = [...prefix, ...inside];
  const taken = new Set(mine.map((s) => s.index));
  const rest = searchSystems(model, q, limit + taken.size)
    .filter((i) => !taken.has(i))
    .map((index): Ranked => ({ index, why: null }));
  return [...mine, ...rest].slice(0, limit);
}

/** A short reason for a suggestion, for the result row ("Exit", "On the map", a character). */
export function whyLabel(why: SuggestionWhy): string {
  switch (why.kind) {
    case 'exit':
      return 'Chain exit';
    case 'map':
      return 'On the map';
    case 'recent':
      return 'Recent';
    case 'character': {
      const first = why.names[0]!;
      const name = first.length > 18 ? `${first.slice(0, 17)}…` : first;
      return why.names.length > 1 ? `${name} +${why.names.length - 1}` : name;
    }
  }
}

/** Recently picked systems by name, most recent first, without repeats (case-insensitive). */
export function pushRecent(list: readonly string[], name: string, max = 6): string[] {
  const lower = name.toLowerCase();
  return [name, ...list.filter((n) => n.toLowerCase() !== lower)].slice(0, max);
}
