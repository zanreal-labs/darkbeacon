import { describe, expect, it } from 'vitest';
import {
  chainTree,
  DEFAULT_BOOKMARK_NUMBERING,
  type BookmarkNumbering,
  type ConnectionDto,
  type MapSystemDto,
} from '@darkbeacon/shared';
import { assignBookmarkNumbers, moveBookmarkNumber, type NumberingCandidate } from './bookmark-numbers.js';

const hole = (connectionId: string, extra: Partial<NumberingCandidate> = {}): NumberingCandidate => ({
  connectionId,
  parent: 1,
  createdAt: Number(connectionId.replace(/\D/g, '')) || 0,
  signature: null,
  destClass: '',
  number: null,
  ...extra,
});

const numbering = (extra: Partial<BookmarkNumbering> = {}): BookmarkNumbering => ({
  ...DEFAULT_BOOKMARK_NUMBERING,
  ...extra,
});

/** Applies an assignment back onto the candidates, as the server stores it. */
const stored = (candidates: NumberingCandidate[], numbers: Map<string, number>) =>
  candidates.map((c) => ({ ...c, number: numbers.get(c.connectionId) ?? null }));

const asObject = (numbers: Map<string, number>) => Object.fromEntries(numbers);

describe('bookmark numbers', () => {
  // Found in this order: h1 (XYZ, HS), h2 (ABC, C3), h3 (no signature, LS), h4 (KLM, C13).
  const siblings = [
    hole('h1', { signature: 'XYZ-777', destClass: 'HS' }),
    hole('h2', { signature: 'ABC-123', destClass: 'C3' }),
    hole('h3', { signature: null, destClass: 'LS' }),
    hole('h4', { signature: 'KLM-456', destClass: 'C13' }),
  ];

  it('numbers new wormholes in the order of the setting', () => {
    expect(asObject(assignBookmarkNumbers(siblings, numbering()))).toEqual({ h1: 1, h2: 2, h3: 3, h4: 4 });
    expect(asObject(assignBookmarkNumbers(siblings, numbering({ order: 'signature' })))).toEqual({
      h2: 1,
      h4: 2,
      h1: 3,
      // Unknown signatures last.
      h3: 4,
    });
    expect(asObject(assignBookmarkNumbers(siblings, numbering({ order: 'class' })))).toEqual({
      h1: 1,
      h3: 2,
      h2: 3,
      // Specials after C1 to C6.
      h4: 4,
    });
    // By hand without any numbers yet: found order.
    expect(asObject(assignBookmarkNumbers(siblings, numbering({ order: 'manual' })))).toEqual({
      h1: 1,
      h2: 2,
      h3: 3,
      h4: 4,
    });
  });

  it('keeps numbers when a sibling closes and fills the lowest gap with the next new one', () => {
    const first = stored(siblings, assignBookmarkNumbers(siblings, numbering()));
    // h2 collapses: the others keep 1, 3, 4.
    const closed = first.filter((c) => c.connectionId !== 'h2');
    const kept = assignBookmarkNumbers(closed, numbering());
    expect(asObject(kept)).toEqual({ h1: 1, h3: 3, h4: 4 });
    // A new hole takes the gap, the one after it the next free number.
    const more = [...stored(closed, kept), hole('h5'), hole('h6')];
    expect(asObject(assignBookmarkNumbers(more, numbering()))).toEqual({
      h1: 1,
      h3: 3,
      h4: 4,
      h5: 2,
      h6: 5,
    });
  });

  it('does not move a number because a newer hole sorts first in the order', () => {
    const before = [hole('h1', { signature: 'XYZ-777', number: 1 })];
    const next = [...before, hole('h2', { signature: 'ABC-123' })];
    expect(asObject(assignBookmarkNumbers(next, numbering({ order: 'signature' })))).toEqual({
      h1: 1,
      h2: 2,
    });
  });

  it('closes the gaps in their current order when renumbering on close', () => {
    const current = [hole('h1', { number: 1 }), hole('h3', { number: 3 }), hole('h4', { number: 4 })];
    expect(asObject(assignBookmarkNumbers(current, numbering({ renumberOnClose: true })))).toEqual({
      h1: 1,
      h3: 2,
      h4: 3,
    });
    // With a new one in the same change it goes last.
    expect(
      asObject(assignBookmarkNumbers([...current, hole('h0')], numbering({ renumberOnClose: true }))),
    ).toEqual({ h1: 1, h3: 2, h4: 3, h0: 4 });
  });

  it('renumbers in the order when asked, one system or all', () => {
    const current = [
      hole('h1', { signature: 'XYZ-777', number: 1 }),
      hole('h2', { signature: 'ABC-123', number: 3 }),
      hole('h9', { parent: 2, signature: 'BBB-222', number: 2 }),
      hole('h8', { parent: 2, signature: 'AAA-111', number: 1 }),
    ];
    const bySig = numbering({ order: 'signature' });
    expect(asObject(assignBookmarkNumbers(current, bySig, new Set([1])))).toEqual({
      h2: 1,
      h1: 2,
      h8: 1,
      h9: 2,
    });
    expect(asObject(assignBookmarkNumbers(current, numbering({ order: 'manual' }), 'all'))).toEqual({
      h1: 1,
      h2: 2,
      h8: 1,
      h9: 2,
    });
  });

  it('settles a number held twice: the older keeps it', () => {
    const twice = [hole('h2', { number: 1 }), hole('h1', { number: 1 })];
    expect(asObject(assignBookmarkNumbers(twice, numbering()))).toEqual({ h1: 1, h2: 2 });
  });

  it('moves a number by hand, swapping with the sibling that had it', () => {
    const current = [hole('h1', { number: 1 }), hole('h2', { number: 2 }), hole('h4', { number: 4 })];
    expect(asObject(moveBookmarkNumber(current, 'h4', 1))).toEqual({ h1: 4, h2: 2, h4: 1 });
    // Into a gap: nobody else moves.
    expect(asObject(moveBookmarkNumber(current, 'h1', 3))).toEqual({ h1: 3, h2: 2, h4: 4 });
    expect(() => moveBookmarkNumber(current, 'h1', 5)).toThrow('Pick a number from 1 to 4');
    expect(() => moveBookmarkNumber(current, 'nope', 1)).toThrow();
    // Kept by the next assignment, in any order.
    const moved = stored(current, moveBookmarkNumber(current, 'h4', 1));
    expect(asObject(assignBookmarkNumbers(moved, numbering({ order: 'signature' })))).toEqual({
      h1: 4,
      h2: 2,
      h4: 1,
    });
  });

  it('counts per parent from every root of the chain', () => {
    const system = (id: number, extra: Partial<MapSystemDto> = {}): MapSystemDto => ({
      mapId: 'm',
      solarSystemId: id,
      position: { x: 0, y: 0 },
      customName: null,
      temporaryName: null,
      tag: null,
      status: 'unknown',
      description: '',
      labelIds: [],
      systemLabelIds: [],
      customLabel: null,
      locked: false,
      visible: true,
      createdAt: id,
      updatedAt: id,
      ...extra,
    });
    const connection = (id: string, source: number, target: number, createdAt: number): ConnectionDto => ({
      id,
      mapId: 'm',
      source,
      target,
      type: id.startsWith('g') ? 'gate' : 'wormhole',
      timeStatus: 'normal',
      massStatus: 'fresh',
      shipSize: 'large',
      massSaved: false,
      dangerous: false,
      bubbled: 'none',
      eolAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    // Two homes (10, 20) and a part of the map without one (30 is its oldest system).
    const systems = [
      system(10, { status: 'home' }),
      system(20, { status: 'home' }),
      system(11),
      system(12),
      system(13),
      system(14),
      system(21),
      system(30),
      system(31),
      system(32),
    ];
    const connections = [
      connection('a', 10, 11, 1),
      connection('b', 12, 10, 2),
      connection('g', 10, 13, 3),
      connection('c', 21, 20, 4),
      connection('d', 11, 14, 5),
      connection('e', 31, 30, 6),
      connection('f', 30, 32, 7),
    ];
    const candidates = chainTree(systems, connections)
      .steps.filter((s) => s.connection.type === 'wormhole')
      .map((s) => hole(s.connection.id, { parent: s.parent, createdAt: s.connection.createdAt }));
    expect(candidates.map((c) => [c.connectionId, c.parent])).toEqual([
      ['a', 10],
      ['b', 10],
      // The stargate out of 10 has no number; the hole out of 11 counts on its own.
      ['d', 11],
      ['c', 20],
      ['e', 30],
      ['f', 30],
    ]);
    expect(asObject(assignBookmarkNumbers(candidates, numbering()))).toEqual({
      a: 1,
      b: 2,
      c: 1,
      d: 1,
      e: 1,
      f: 2,
    });
  });
});
