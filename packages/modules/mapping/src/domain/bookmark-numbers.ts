import { ValidationError } from '@darkbeacon/core';
import { compareBookmarkSiblings, type BookmarkNumbering, type BookmarkSibling } from '@darkbeacon/shared';

/**
 * A wormhole to number: what the orders sort by, the system it leads out of in the chain, and
 * its number there (`number`, null when it has none or it was given for another parent).
 */
export interface NumberingCandidate extends BookmarkSibling {
  parent: number;
}

/** Which systems' wormholes are numbered 1, 2, 3 again: none, all, or those out of these systems. */
export type Renumber = 'none' | 'all' | ReadonlySet<number>;

/**
 * `{n}` for every wormhole, counted among the wormholes out of the same parent system.
 *
 * - Numbers are stable: a wormhole keeps its number while it leads out of the same system, so a
 *   sibling closing leaves a gap and nothing shifts.
 * - A wormhole without one (new, or reached from another system now) takes the lowest free
 *   number; several at once take them in the map's order.
 * - Two holding the same number (never by these rules, but stored data may say so): the one
 *   first by number then found keeps it, the other is treated as new.
 * - `renumberOnClose`: the kept numbers close their gaps instead, in their current order.
 * - `renumber` (asked for, e.g. a new order): 1, 2, 3 in the map's order, old numbers ignored
 *   except as the order itself when the order is `manual`.
 */
export function assignBookmarkNumbers(
  candidates: readonly NumberingCandidate[],
  numbering: BookmarkNumbering,
  renumber: Renumber = 'none',
): Map<string, number> {
  const compare = compareBookmarkSiblings(numbering.order);
  const result = new Map<string, number>();
  for (const [parent, group] of groupByParent(candidates)) {
    if (renumber === 'all' || (renumber !== 'none' && renumber.has(parent))) {
      [...group].sort(compare).forEach((c, i) => result.set(c.connectionId, i + 1));
      continue;
    }

    const holders = group
      .filter((c) => c.number !== null)
      .sort((a, b) => a.number! - b.number! || a.createdAt - b.createdAt);
    const kept: NumberingCandidate[] = [];
    const fresh: NumberingCandidate[] = group.filter((c) => c.number === null);
    const held = new Set<number>();
    for (const c of holders) {
      if (held.has(c.number!)) fresh.push(c);
      else {
        held.add(c.number!);
        kept.push(c);
      }
    }

    const taken = new Set<number>();
    kept.forEach((c, i) => {
      const n = numbering.renumberOnClose ? i + 1 : c.number!;
      result.set(c.connectionId, n);
      taken.add(n);
    });
    let next = 1;
    for (const c of fresh.sort(compare)) {
      while (taken.has(next)) next++;
      result.set(c.connectionId, next);
      taken.add(next);
    }
  }
  return result;
}

/**
 * A wormhole moved to `number` by hand among its siblings (all of one parent): the sibling that
 * held the number takes the moved one's old number, or the lowest free one when it had none.
 * Allowed up to the number of siblings, or the highest number in use when gaps push it higher.
 * Returns the siblings' numbers afterwards.
 */
export function moveBookmarkNumber(
  siblings: readonly NumberingCandidate[],
  connectionId: string,
  number: number,
): Map<string, number> {
  const moved = siblings.find((c) => c.connectionId === connectionId);
  if (!moved) throw new ValidationError('That wormhole is not numbered here');
  const highest = Math.max(siblings.length, ...siblings.map((c) => c.number ?? 0));
  if (number < 1 || number > highest)
    throw new ValidationError(`Pick a number from 1 to ${highest}`, { number });

  const numbers = new Map(siblings.map((c) => [c.connectionId, c.number]));
  const holder = siblings.find((c) => c.connectionId !== connectionId && c.number === number);
  numbers.set(connectionId, number);
  if (holder) {
    const taken = new Set([...numbers.values()].filter((n): n is number => n !== null));
    let swap = moved.number;
    if (swap === null) {
      swap = 1;
      while (taken.has(swap)) swap++;
    }
    numbers.set(holder.connectionId, swap);
  }
  const result = new Map<string, number>();
  for (const [id, n] of numbers) if (n !== null) result.set(id, n);
  return result;
}

function groupByParent(candidates: readonly NumberingCandidate[]): Map<number, NumberingCandidate[]> {
  const groups = new Map<number, NumberingCandidate[]>();
  for (const c of candidates) groups.set(c.parent, [...(groups.get(c.parent) ?? []), c]);
  return groups;
}
