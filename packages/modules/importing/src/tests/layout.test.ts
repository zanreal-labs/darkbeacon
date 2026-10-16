import { describe, expect, it } from 'vitest';
import { GRID, NODE_ROOM, spreadLayout } from '../domain/layout.js';

/** The widest a node gets in the default theme (`--dbk-node-min-width` x 1.6), and its height with chips. */
const WIDEST_NODE = 240;
const NODE_WITH_CHIPS = 70 + 30;

describe('spreading a Wanderer layout', () => {
  it('leaves room for a connection between the widest nodes side by side on a Wanderer grid', () => {
    // A chain on Wanderer's grid: 180 px apart, a branch one row (75 px) below.
    const { positions, scale } = spreadLayout([
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 360, y: 0 },
      { x: 180, y: 75 },
    ]);
    expect(scale).toBeGreaterThan(1);
    const [a, b, , below] = positions;
    expect(b!.x - a!.x - WIDEST_NODE).toBeGreaterThanOrEqual(20);
    expect(below!.y - b!.y - NODE_WITH_CHIPS).toBeGreaterThanOrEqual(20);
  });

  it('keeps a layout that already has the room as it is, only putting it on the grid', () => {
    const roomy = [
      { x: 0, y: 0 },
      { x: NODE_ROOM.width, y: 0 },
      { x: 0, y: NODE_ROOM.height },
    ];
    const onGrid = (v: number) => Math.round(v / GRID) * GRID;
    expect(spreadLayout(roomy)).toEqual({
      positions: roomy.map((p) => ({ x: onGrid(p.x), y: onGrid(p.y) })),
      scale: 1,
    });
  });

  it('lands every system on the map grid, so rows and columns line up', () => {
    const { positions } = spreadLayout([
      { x: 7, y: 13 },
      { x: 187, y: 88 },
    ]);
    for (const p of positions) expect([p.x % GRID, p.y % GRID]).toEqual([0, 0]);
  });

  it('spreads at most three times', () => {
    expect(
      spreadLayout([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]).scale,
    ).toBe(3);
  });
});
