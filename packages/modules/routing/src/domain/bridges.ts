/**
 * Ansiblex jump bridges: reading lists people paste, and which bridges a pilot may use.
 *
 * In game an Ansiblex is named after the two systems it links, "1DQ1-A » 8WA-Z6 - Home Bridge",
 * and the structure browser copies one per line, often with more columns after a tab. People
 * also share lists as "UALX-3 -> 1DQ1-A", "A - B", "A, B", with tabs or just a space between the
 * names ("PQRE-W A-7XFN").
 */

/** The SDE type id of the Ansiblex Jump Gate. */
export const ANSIBLEX_TYPE_ID = 35841;

/**
 * How far apart two linked Ansiblexes may stand: "within 5 light years", as the conduit
 * generator's description in the SDE (type 35913) says.
 */
export const ANSIBLEX_RANGE_LY = 5;

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

/**
 * Reads every line of a paste into pairs of names; names are resolved to systems elsewhere.
 * `isSystem` (a cleaned name is a solar system) settles lines without an arrow: null-sec names
 * hold dashes and some names hold spaces ("3-LJW3 M-ZJWJ", "Old Man Star Jita"), so every split
 * point is tried and the one whose both halves are systems wins.
 */
export function parseBridgeLines(
  text: string,
  isSystem?: (name: string) => boolean,
): { pairs: BridgeLine[]; unreadable: UnreadableLine[] } {
  const pairs: BridgeLine[] = [];
  const unreadable: UnreadableLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const pair = splitPair(raw, isSystem);
    if (!pair) return unreadable.push({ line, text: trimmed, reason: 'Two system names were expected' });
    const from = cleanSystemName(pair[0]);
    const to = cleanSystemName(pair[1]);
    if (!from || !to)
      return unreadable.push({ line, text: trimmed, reason: 'Two system names were expected' });
    pairs.push({ line, text: trimmed, from, to });
  });
  return { pairs, unreadable };
}

function splitPair(raw: string, isSystem?: (name: string) => boolean): [string, string] | null {
  const line = raw.trim();
  let best: { at: number; arrow: string } | null = null;
  for (const arrow of ARROWS) {
    const at = line.indexOf(arrow);
    if (at > 0 && (!best || at < best.at)) best = { at, arrow };
  }
  if (best) return [nearName(line.slice(0, best.at)), farName(line.slice(best.at + best.arrow.length))];
  const known = isSystem && splitByNames(line, isSystem);
  if (known) return known;
  for (const separator of SEPARATORS) {
    const at = line.indexOf(separator);
    if (at > 0) return [line.slice(0, at), line.slice(at + separator.length)];
  }
  // "3-LJW3 M-ZJWJ": two words, the space between them.
  const words = line.split(/\s+/);
  if (words.length === 2) return [words[0]!, words[1]!];
  return null;
}

/**
 * The split of a line whose both halves are systems: at a separator first, then at a space, then
 * at a dash ("PQRE-W-A-7XFN"), leftmost first. Null when no split names two systems.
 */
function splitByNames(line: string, isSystem: (name: string) => boolean): [string, string] | null {
  const points: Array<{ at: number; length: number }> = [];
  for (const separator of SEPARATORS) {
    for (let at = line.indexOf(separator); at >= 0; at = line.indexOf(separator, at + 1))
      points.push({ at, length: separator.length });
  }
  for (const space of line.matchAll(/\s+/g)) points.push({ at: space.index, length: space[0].length });
  for (const dash of line.matchAll(/-/g)) points.push({ at: dash.index, length: 1 });
  for (const { at, length } of points) {
    if (at <= 0) continue;
    const near = line.slice(0, at);
    const far = line.slice(at + length);
    const a = cleanSystemName(near);
    const b = cleanSystemName(far);
    if (a && b && isSystem(a) && isSystem(b)) return [near, far];
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
  const { pairs } = parseBridgeLines(structureName, (name) => systemByName(name) !== null);
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

/**
 * The pilot a route is for, as far as bridges go: their direct alliance (null: in none). Null when
 * no pilot is known (what every viewer of a map sees), and every bridge may then be used.
 */
export type BridgePilot = { allianceId: number | null } | null;

/**
 * Whether a pilot may take a bridge. A bridge whose owner is known (found through ESI) is for the
 * pilots of the alliance owning it only, as the game has it since 2026-09-22; one whose owner is
 * not known (pasted by hand) falls back on sovereignty (`isForeignBridge`), when it is known.
 */
export function mayUseBridge(
  edge: { a: number; b: number; ownerAllianceId?: number | null | undefined },
  pilot: BridgePilot,
  holderOf: ((solarSystemId: number) => number | null) | null,
): boolean {
  if (pilot === null) return true;
  if (edge.ownerAllianceId !== undefined && edge.ownerAllianceId !== null)
    return edge.ownerAllianceId === pilot.allianceId;
  return holderOf === null || !isForeignBridge(edge.a, edge.b, pilot.allianceId, holderOf);
}

/**
 * Why ESI gave no structures: EVE refused (no role, grant gone), no working login, the grant
 * lacks a scope the read needs (linking the character again with it fixes that), or no answer.
 */
export class EsiStructuresError extends Error {
  constructor(
    readonly reason: 'forbidden' | 'no-token' | 'no-scope' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'EsiStructuresError';
  }
}
