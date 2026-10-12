import type { ChainObjectKind, ChainOrigin } from '@darkbeacon/shared';

/** An object of a chain by its stable key (see `ChainKey` in shared). */
export interface ObjectRef {
  kind: ChainObjectKind;
  key: string;
}

/** `kind|key`: one string per object, for maps and sets. */
export function refId(kind: ChainObjectKind, key: string): string {
  return `${kind}|${key}`;
}

export function parseRefId(id: string): ObjectRef {
  const at = id.indexOf('|');
  return { kind: id.slice(0, at) as ChainObjectKind, key: id.slice(at + 1) };
}

/** `<low>-<high>`: the connection between two systems, in either direction. */
export function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function parsePair(key: string): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** `<system>:<code>`: a signature. */
export function signatureKey(solarSystemId: number, eveId: string): string {
  return `${solarSystemId}:${eveId}`;
}

export function parseSignatureKey(key: string): { solarSystemId: number; eveId: string } | null {
  const m = /^(\d+):([A-Z]{3}-\d{3})$/.exec(key);
  return m ? { solarSystemId: Number(m[1]), eveId: m[2]! } : null;
}

/** Ids the merged map shows: deterministic from the keys, so they survive restarts and never name a source row. */
export const mergedId = {
  system: (solarSystemId: number) => solarSystemId,
  /** `c:<pair>` for the first connection between two systems, `c:<pair>:<type>` for another hole there. */
  connection: (groupKey: string) => `c:${groupKey}`,
  signature: (key: string) => `s:${key}`,
};

/** The connection group key (`<pair>` or `<pair>:<type>`) behind a merged connection id. */
export function connectionGroupOf(id: string): { pair: string; type: string | null } | null {
  const m = /^c:(\d+-\d+)(?::([A-Za-z0-9]+))?$/.exec(id);
  return m ? { pair: m[1]!, type: m[2] ?? null } : null;
}

export function signatureKeyOf(id: string): string | null {
  return id.startsWith('s:') && parseSignatureKey(id.slice(2)) ? id.slice(2) : null;
}

/** `local:<map>` or `<instance>:<map>`: one string per source map. */
export function originId(origin: ChainOrigin): string {
  return `${origin.instance}:${origin.mapId}`;
}

export function sameOrigin(a: ChainOrigin, b: ChainOrigin): boolean {
  return a.instance === b.instance && a.mapId === b.mapId;
}
