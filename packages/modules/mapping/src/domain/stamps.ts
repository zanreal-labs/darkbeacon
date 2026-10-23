import type { Connection, MapSystem, Signature } from './map.js';

/** Field name -> when it last changed (epoch ms). */
export type FieldTimes = Record<string, number>;

export type StampedKind = 'system' | 'connection' | 'signature';

/** What a merged map shows instead of its own rows (see `ChainOverlay`). */
export interface ChainView {
  systems: MapSystem[];
  connections: Connection[];
  signatures: Signature[];
}

/** Fields that are bookkeeping, not content: never stamped. */
const UNSTAMPED = new Set(['mapId', 'createdAt', 'updatedAt', 'provenance']);

/**
 * The field times after `current` became `next` at `at`: every content field whose value
 * changed is stamped with `at`, the others keep their time. `written`: fields stamped even when
 * their value stays (see `UpdateOptions`).
 */
export function stampChanges<T extends object>(
  current: T,
  next: T,
  times: FieldTimes,
  at: number,
  written: readonly string[] = [],
): FieldTimes {
  const out: FieldTimes = { ...times };
  for (const key of written) if (!UNSTAMPED.has(key)) out[key] = at;
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    if (UNSTAMPED.has(key)) continue;
    const before = (current as Record<string, unknown>)[key];
    const after = (next as Record<string, unknown>)[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) out[key] = at;
  }
  return out;
}

/** `<low>-<high>`: the key of the connection between two systems, in either direction. */
export function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

/** `<system>:<code>`: the key of a signature. */
export function signatureKey(solarSystemId: number, eveId: string): string {
  return `${solarSystemId}:${eveId}`;
}
