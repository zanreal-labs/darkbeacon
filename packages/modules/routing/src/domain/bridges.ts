/**
 * Ansiblex jump bridges: reading lists people paste, and which bridges a pilot may use.
 *
 * In game an Ansiblex is named after the two systems it links, "1DQ1-A » 8WA-Z6 - Home Bridge",
 * and the structure browser copies one per line, often with more columns after a tab. People
 * also share lists as "UALX-3 -> 1DQ1-A", "A - B", "A, B" or with tabs.
 */

/** The SDE type id of the Ansiblex Jump Gate. */
export const ANSIBLEX_TYPE_ID = 35841;

/** A pair of system names read from one line. */
export interface BridgeLine {
  /** 1-based line number in the paste. */
  line: number;
  text: string;
  from: string;
  to: string;
}

export interface UnreadableLine {
  line: number;
  text: string;
  reason: string;
}

/** Arrows split a line first: everything after the second name is the structure's own name. */
const ARROWS = ['<->', '<=>', '»', '>>', '-->', '->', '=>', '→'];
/** Without an arrow, these separate the two names (the first one found wins). */
const SEPARATORS = ['\t', ' — ', '—', ' – ', '–', ' - ', ' | ', '|', ',', ';'];

/** A grid marker some lists put after a name ("PQRE-W 1-1"). */
const GRID = /\s+\d+-\d+$/;

/** One system name: no brackets, no "Ansiblex Jump Gate", no dashes or grid marker at the ends. */
export function cleanSystemName(raw: string): string {
  let name = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/ansiblex jump gate/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^[-–—\s]+|[-–—\s]+$/g, '');
  if (GRID.test(name)) name = name.replace(GRID, '');
  return name.trim();
}

/** The part of the line after an arrow up to the structure's name: "8WA-Z6 - Home Bridge" -> "8WA-Z6". */
function farName(rest: string): string {
  const column = rest.split('\t')[0]!;
  const dash = column.search(/\s+[-–—]\s+/);
  return dash >= 0 ? column.slice(0, dash) : column;
}

/** The part before an arrow: the last column ("Ansiblex\t1DQ1-A » ..." -> "1DQ1-A"). */
function nearName(before: string): string {
  const columns = before.split('\t');
  return columns[columns.length - 1]!;
}

/** Reads every line of a paste into pairs of names; names are resolved to systems elsewhere. */
export function parseBridgeLines(text: string): { pairs: BridgeLine[]; unreadable: UnreadableLine[] } {
  const pairs: BridgeLine[] = [];
  const unreadable: UnreadableLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const pair = splitPair(raw);
    if (!pair) return unreadable.push({ line, text: trimmed, reason: 'Two system names were expected' });
    const from = cleanSystemName(pair[0]);
    const to = cleanSystemName(pair[1]);
    if (!from || !to)
      return unreadable.push({ line, text: trimmed, reason: 'Two system names were expected' });
    pairs.push({ line, text: trimmed, from, to });
  });
  return { pairs, unreadable };
}

function splitPair(raw: string): [string, string] | null {
  const line = raw.trim();
  let best: { at: number; arrow: string } | null = null;
  for (const arrow of ARROWS) {
    const at = line.indexOf(arrow);
    if (at > 0 && (!best || at < best.at)) best = { at, arrow };
  }
  if (best) return [nearName(line.slice(0, best.at)), farName(line.slice(best.at + best.arrow.length))];
  for (const separator of SEPARATORS) {
    const at = line.indexOf(separator);
    if (at > 0) return [line.slice(0, at), line.slice(at + separator.length)];
  }
  return null;
}

/**
 * The system an Ansiblex links to, from its name and the system it stands in: of the names in
 * "1DQ1-A » 8WA-Z6 - Home Bridge", the one that is a system other than its own. Null when the
 * name does not tell (renamed gates).
 */
export function farSideOf(
  structureName: string,
  ownSystemId: number,
  systemByName: (name: string) => number | null,
): number | null {
  const { pairs } = parseBridgeLines(structureName);
  const pair = pairs[0];
  if (!pair) return null;
  for (const name of [pair.from, pair.to]) {
    const id = systemByName(name);
    if (id !== null && id !== ownSystemId) return id;
  }
  return null;
}

/**
 * Since 2026-09-22 only the alliance holding sovereignty over a bridge's system may use it
 * (https://www.eveonline.com/news/view/patch-notes-version-24-01). A bridge belongs to another
 * alliance when a known holder of either of its systems is not the pilot's alliance. Without the
 * pilot's alliance or any known holder nothing is proven, and the bridge may be used.
 */
export function isForeignBridge(
  a: number,
  b: number,
  alliance: number | null,
  holderOf: (solarSystemId: number) => number | null,
): boolean {
  if (alliance === null) return false;
  return [holderOf(a), holderOf(b)].some((holder) => holder !== null && holder !== alliance);
}

/** Why ESI gave no structures: no grant or role, no corporation, or no answer. */
export class EsiStructuresError extends Error {
  constructor(
    readonly reason: 'forbidden' | 'no-token' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'EsiStructuresError';
  }
}
