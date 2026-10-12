import type { MassMode, PassageSource, ShareScope } from '@darkbeacon/shared';

/**
 * A passage as a source hands it to a map that merges it: no row id of the source (only its own
 * merged view keeps ids), the pilot only when the share includes characters. `key` tells the same
 * tracked jump recorded by two sources apart from two jumps, without naming the pilot.
 */
export interface ChainPassage {
  key: string;
  /** The source's row id; only for the map's own passages (`self`), which stay editable. */
  id?: string;
  at: number;
  from: number;
  to: number;
  shipTypeId: number | null;
  mass: number | null;
  source: PassageSource;
  massMode: MassMode;
  higgs: boolean;
  entangler: boolean;
  note: string | null;
  /** Only with the `characters` scope. */
  pilot: { id: number; name: string | null } | null;
}

/** What "Log a jump" through a merged map sends to the source that records it. */
export interface ChainPassageLog {
  shipTypeId: number;
  /** The system it left, by id (one end of the pair). */
  from: string;
  massMode: MassMode;
  higgs?: boolean;
  entangler?: boolean;
  mass?: number;
  note?: string;
  count: number;
  at?: number;
}

/** Passages are part of a connection's status: shared with `connectionStatus` only. */
export function passagesShared(scopes: readonly ShareScope[] | 'all'): boolean {
  return scopes === 'all' || scopes.includes('connectionStatus');
}

/** Pilots of passages travel with the `characters` scope only. */
export function pilotsShared(scopes: readonly ShareScope[] | 'all'): boolean {
  return scopes === 'all' || scopes.includes('characters');
}

/**
 * A stable, opaque key of a passage: a tracked jump is the pilot, the systems and the moment (two
 * maps tracking one pilot record the same jump), a hand-logged one is its own row. FNV-1a, so the
 * pilot cannot be read back from it.
 */
export function passageKey(p: {
  id: string;
  source: PassageSource;
  characterId: number | null;
  from: number;
  to: number;
  at: number;
}): string {
  const text =
    p.source === 'tracked' && p.characterId !== null
      ? `t:${p.characterId}:${p.from}:${p.to}:${p.at}`
      : `m:${p.id}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${p.source === 'tracked' ? 't' : 'm'}${hash.toString(36)}${text.length.toString(36)}`;
}

/**
 * The passages of a merged connection from each source holding it, oldest source first: one row
 * per jump (the first source that recorded a tracked jump keeps it), newest first.
 */
export function mergePassages<T extends { passage: ChainPassage }>(perSource: readonly T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const rows of perSource) {
    for (const row of rows) {
      if (seen.has(row.passage.key)) continue;
      seen.add(row.passage.key);
      out.push(row);
    }
  }
  return out.sort((a, b) => b.passage.at - a.passage.at);
}
