import { describe, expect, it } from 'vitest';
import { NODE_ROOM, spreadLayout } from '../domain/layout.js';

/** The widest a node gets in the default theme (`--dbk-node-min-width` x 1.6), and its height with chips. */
const WIDEST_NODE = 320;
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

  it('keeps a layout that already has the room as it is', () => {
    const roomy = [
      { x: 0, y: 0 },
      { x: NODE_ROOM.width, y: 0 },
      { x: 0, y: NODE_ROOM.height },
    ];
    expect(spreadLayout(roomy)).toEqual({ positions: roomy, scale: 1 });
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
