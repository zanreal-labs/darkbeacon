import { describe, expect, it } from 'vitest';
import { fitHere, GRID, NODE_ROOM, spreadLayout, type LaidOutSystem } from '../domain/layout.js';

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

describe('fitting a merged system into the map', () => {
  const HOME = 31001269;
  const EXIT = 30000323;
  const at = (solarSystemId: number, x: number, y: number, status = 'unknown'): LaidOutSystem => ({
    solarSystemId,
    position: { x, y },
    visible: true,
    status,
  });
  const systems = [at(HOME, 2640, -3312, 'home'), at(30000759, 2640, -3456)];

  it('keeps a free spot next to the system it hangs off', () => {
    const spot = { x: 3000, y: -3312 };
    expect(fitHere({ solarSystemId: EXIT, spot, systems, links: [], neighbours: [HOME] })).toEqual(spot);
  });

  it('moves a system Wanderer put on top of another next to its neighbour', () => {
    // Seen on a live map: Wanderer's spot 48 px over home.
    const placed = fitHere({
      solarSystemId: EXIT,
      spot: { x: 2640, y: -3360 },
      systems,
      links: [],
      neighbours: [HOME],
    });
    expect(placed).not.toEqual({ x: 2640, y: -3360 });
    expect(placed.x).toBe(2640 + 360);
  });

  it('never keeps a spot Wanderer has above its neighbour in the same column', () => {
    // Seen on a live map: Proundly Snoring above home, in home's column (here two rows up, one is taken).
    const placed = fitHere({
      solarSystemId: EXIT,
      spot: { x: 2640, y: -3600 },
      systems,
      links: [],
      neighbours: [HOME],
    });
    expect(placed).toEqual({ x: 2640 + 360, y: -3312 });
  });

  it('brings a system Wanderer put far off the chain back next to it', () => {
    const placed = fitHere({
      solarSystemId: EXIT,
      spot: { x: 1056, y: 4512 },
      systems,
      links: [],
      neighbours: [HOME],
    });
    expect(Math.abs(placed.x - 2640)).toBeLessThanOrEqual(360);
    expect(Math.abs(placed.y + 3312)).toBeLessThanOrEqual(3 * 144);
  });

  it('settles a system connected to nothing shown next to home', () => {
    const placed = fitHere({
      solarSystemId: EXIT,
      spot: { x: 312, y: 0 },
      systems,
      links: [],
      neighbours: [],
    });
    expect(Math.abs(placed.x - 2640)).toBeLessThanOrEqual(2 * 360);
    expect(Math.abs(placed.y + 3312)).toBeLessThanOrEqual(3 * 144);
  });
});
