import { describe, expect, it } from 'vitest';
import {
  MAP_GRID,
  SYSTEM_BOX,
  SYSTEM_FOOTPRINT,
  SYSTEM_NODE_CENTRE,
  SYSTEM_PLACEMENT,
  segmentHitsRect,
  segmentsCross,
  type Position,
} from '@darkbeacon/shared';
import type { Connection, MapSystem } from './map.js';
import { placeSystem, type PlacementHint } from './placement.js';

const { x: COLUMN, y: ROW } = SYSTEM_PLACEMENT;

/** A map being laid out: systems and connections in the order they were added. */
class Chain {
  systems: MapSystem[] = [];
  connections: Connection[] = [];
  private clock = 0;

  put(id: number, position: Position, extra: Partial<MapSystem> = {}): this {
    const now = ++this.clock;
    this.systems.push({
      mapId: 'm',
      solarSystemId: id,
      position,
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
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    return this;
  }

  link(source: number, target: number): this {
    const now = ++this.clock;
    this.connections.push({
      id: `c${now}`,
      mapId: 'm',
      source,
      target,
      type: 'wormhole',
      timeStatus: 'normal',
      massStatus: 'fresh',
      shipSize: 'large',
      massSaved: false,
      dangerous: false,
      bubbled: 'none',
      eolAt: null,
      massStatusAt: null,
      bookmarkNumber: null,
      bookmarkParent: null,
      createdAt: now,
      updatedAt: now,
    });
    return this;
  }

  place(hint: PlacementHint = {}): Position {
    return placeSystem(this.systems, this.connections, hint);
  }

  /** What auto-mapping does on a jump from `from` into `to`. */
  jump(from: number, to: number): Position {
    const at = this.place({ near: from });
    this.put(to, at).link(from, to);
    return at;
  }

  at(id: number): Position {
    return this.systems.find((s) => s.solarSystemId === id)!.position;
  }
}

const area = (p: Position, a: typeof SYSTEM_BOX | typeof SYSTEM_FOOTPRINT) => ({
  l: p.x + a.left,
  t: p.y + a.top,
  r: p.x + a.left + a.width,
  b: p.y + a.top + a.height,
});
/** With its label row and chips. */
const footprint = (p: Position) => area(p, SYSTEM_FOOTPRINT);
const centre = (p: Position) => ({ x: p.x + SYSTEM_NODE_CENTRE.x, y: p.y + SYSTEM_NODE_CENTRE.y });

/** What a mapper would call a bad layout: overlaps, off-grid spots, crossings, nodes on lines. */
function problems(chain: Chain): string[] {
  const out: string[] = [];
  const shown = chain.systems.filter((s) => s.visible);
  for (const [i, a] of shown.entries()) {
    if (a.position.x % MAP_GRID || a.position.y % MAP_GRID) out.push(`${a.solarSystemId} off grid`);
    for (const b of shown.slice(i + 1)) {
      const [p, q] = [footprint(a.position), footprint(b.position)];
      if (p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b)
        out.push(`${a.solarSystemId} over ${b.solarSystemId}`);
    }
  }
  const at = new Map(shown.map((s) => [s.solarSystemId, centre(s.position)]));
  const lines = chain.connections.filter((c) => at.has(c.source) && at.has(c.target));
  for (const [i, c] of lines.entries()) {
    const linked = (a: number, b: number) =>
      lines.some((d) => (d.source === a && d.target === b) || (d.source === b && d.target === a));
    for (const s of shown) {
      if (s.solarSystemId === c.source || s.solarSystemId === c.target) continue;
      // Links fanning out of one system to a column of its children graze each other's corners.
      if (linked(s.solarSystemId, c.source) || linked(s.solarSystemId, c.target)) continue;
      if (segmentHitsRect(at.get(c.source)!, at.get(c.target)!, area(s.position, SYSTEM_BOX)))
        out.push(`${s.solarSystemId} on ${c.source}-${c.target}`);
    }
    for (const d of lines.slice(i + 1)) {
      if ([c.source, c.target].some((e) => e === d.source || e === d.target)) continue;
      if (segmentsCross(at.get(c.source)!, at.get(c.target)!, at.get(d.source)!, at.get(d.target)!))
        out.push(`${c.source}-${c.target} crosses ${d.source}-${d.target}`);
    }
  }
  return out;
}

describe('placing a system nobody dragged', () => {
  it('starts an empty map at the origin, or where the viewer looks, on the grid', () => {
    expect(new Chain().place()).toEqual({ x: 0, y: 0 });
    expect(new Chain().place({ around: { x: 1000, y: -490 } })).toEqual({ x: 1008, y: -480 });
  });

  it('puts a system one column right of the system it was reached from, in its row', () => {
    const chain = new Chain().put(1, { x: 0, y: 0 });
    expect(chain.jump(1, 2)).toEqual({ x: COLUMN, y: 0 });
    expect(chain.jump(2, 3)).toEqual({ x: 2 * COLUMN, y: 0 });
  });

  it('snaps to the map grid even next to a system that is off it', () => {
    const chain = new Chain().put(1, { x: 10, y: 13 });
    expect(chain.jump(1, 2)).toEqual({ x: 360, y: 24 });
  });

  it('stacks siblings in a column under each other', () => {
    const chain = new Chain().put(1, { x: 0, y: 0 }, { status: 'home' });
    for (const id of [2, 3, 4]) chain.jump(1, id);
    expect([2, 3, 4].map((id) => chain.at(id))).toEqual([
      { x: COLUMN, y: 0 },
      { x: COLUMN, y: ROW },
      { x: COLUMN, y: 2 * ROW },
    ]);
  });

  it('tries the slot below, then above, when the next one is taken', () => {
    const chain = new Chain().put(1, { x: 0, y: 0 }).put(9, { x: COLUMN, y: 0 });
    expect(chain.place({ near: 1 })).toEqual({ x: COLUMN, y: ROW });
    chain.put(8, { x: COLUMN, y: ROW });
    expect(chain.place({ near: 1 })).toEqual({ x: COLUMN, y: -ROW });
  });

  it('keeps clear of a neighbour’s labels and chips, even one dragged off the grid', () => {
    // A system dragged to 120 px below the free slot: its label row reaches into the next one.
    const chain = new Chain().put(1, { x: 0, y: 0 }).put(9, { x: COLUMN + 30, y: ROW - 20 });
    const spot = chain.place({ near: 1 });
    chain.put(2, spot).link(1, 2);
    expect(problems(chain).filter((p) => !p.startsWith('9 off grid'))).toEqual([]);
  });

  it('passes over a slot an existing connection runs through', () => {
    // 8 (below-left) to 9 (above-right) runs through the slot right of 1.
    const chain = new Chain()
      .put(1, { x: 0, y: 0 })
      .put(8, { x: 0, y: ROW })
      .put(9, { x: 2 * COLUMN, y: -ROW })
      .link(8, 9);
    expect(chain.place({ near: 1 })).toEqual({ x: COLUMN, y: -ROW });
  });

  it('follows the chain’s direction when it grows left', () => {
    const chain = new Chain()
      .put(1, { x: 0, y: 0 }, { status: 'home' })
      .put(2, { x: -COLUMN, y: 0 })
      .link(1, 2);
    expect(chain.jump(2, 3)).toEqual({ x: -2 * COLUMN, y: 0 });
  });

  it('without a parent: near the viewer’s screen, else next to home, else below the last one', () => {
    const chain = new Chain()
      .put(1, { x: 0, y: 0 }, { status: 'home' })
      .put(2, { x: COLUMN, y: 0 })
      .put(3, { x: 2 * COLUMN, y: 0 })
      .link(1, 2)
      .link(2, 3);
    // The middle of the screen, in line with the nearest system's rows and columns; taken: the
    // nearest free slot.
    expect(chain.place({ around: { x: 5000, y: 1010 } })).toEqual({
      x: 2 * COLUMN + 12 * COLUMN,
      y: 7 * ROW,
    });
    expect(chain.place({ around: { x: COLUMN + 5, y: 3 } })).toEqual({ x: COLUMN, y: ROW });
    // Next to home, below it; never right of everything.
    expect(chain.place()).toEqual({ x: 0, y: ROW });
    const noHome = new Chain().put(1, { x: 0, y: 0 }).put(2, { x: 3000, y: 600 }).put(3, { x: 720, y: 0 });
    expect(noHome.place()).toEqual({ x: 720, y: ROW });
  });

  it('ignores a parent that is not on the map', () => {
    const chain = new Chain()
      .put(1, { x: 0, y: 0 }, { status: 'home' })
      .put(2, { x: 0, y: 500 }, { visible: false });
    expect(chain.place({ near: 2 })).toEqual({ x: 0, y: ROW });
  });

  describe('restoring a hidden system', () => {
    const chain = () =>
      new Chain().put(1, { x: 0, y: 0 }, { status: 'home' }).put(2, { x: COLUMN, y: 0 }).link(1, 2);

    it('takes its old spot back when it is free and near its parent', () => {
      // Off the grid on purpose: someone dragged it there.
      expect(chain().place({ near: 2, previous: { x: 2 * COLUMN + 7, y: 100 } })).toEqual({
        x: 2 * COLUMN + 7,
        y: 100,
      });
    });

    it('is placed like a new system when its old spot is taken or far from its parent', () => {
      const taken = chain().put(3, { x: 2 * COLUMN, y: 0 });
      expect(taken.place({ near: 2, previous: { x: 2 * COLUMN, y: 10 } })).toEqual({ x: 2 * COLUMN, y: ROW });
      // Wanderer imports keep old systems hidden far away.
      expect(chain().place({ near: 2, previous: { x: 24000, y: 24000 } })).toEqual({ x: 2 * COLUMN, y: 0 });
    });

    it('without a parent, keeps an old spot near the chain only', () => {
      expect(chain().place({ previous: { x: 0, y: 2 * ROW } })).toEqual({ x: 0, y: 2 * ROW });
      expect(chain().place({ previous: { x: 24000, y: 9000 } })).toEqual({ x: 0, y: ROW });
    });
  });

  describe('a scout’s day, as auto-mapping places it', () => {
    it('keeps a chain with a K162 off its middle free of overlaps and crossings', () => {
      const [HOME, A, B, C, D, E, F, G, I, K, L] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const chain = new Chain().put(HOME, { x: 0, y: 0 }, { status: 'home' });
      // Three holes out, the second static two deep, a K162 into A, a hole off B, a third exit.
      for (const [from, to] of [
        [HOME, A],
        [A, B],
        [B, C],
        [HOME, D],
        [D, E],
        [A, F],
        [F, G],
        [B, I],
        [HOME, K],
        [K, L],
      ] as const)
        chain.jump(from, to);
      expect(problems(chain)).toEqual([]);
      // Every system next to the one it was reached from: one column on.
      for (const c of chain.connections) {
        expect(Math.abs(chain.at(c.target).x - chain.at(c.source).x)).toBe(COLUMN);
      }
    });

    it('keeps a big chain explored depth first readable', () => {
      const tree: Record<number, number[]> = {
        1: [2, 3, 4],
        2: [5, 6, 7],
        3: [8, 9],
        4: [10, 11],
        5: [12, 13],
        6: [14],
        7: [15, 16],
        8: [17, 18, 19],
        10: [20],
        12: [21],
        15: [22, 23],
        18: [24],
        20: [25, 26],
      };
      const chain = new Chain().put(1, { x: 0, y: 0 }, { status: 'home' });
      const walk = (at: number) => {
        for (const child of tree[at] ?? []) {
          chain.jump(at, child);
          walk(child);
        }
      };
      walk(1);
      expect(problems(chain)).toEqual([]);
      for (const c of chain.connections) {
        expect(Math.abs(chain.at(c.target).x - chain.at(c.source).x)).toBe(COLUMN);
        expect(Math.abs(chain.at(c.target).y - chain.at(c.source).y)).toBeLessThanOrEqual(5 * ROW);
      }
    });
  });
});
