import { describe, expect, it } from 'vitest';
import {
  asPosition,
  besideNeighbour,
  clusterOffset,
  extentOf,
  placedAsSourceHasIt,
  placeFree,
  shifted,
  type Extent,
} from './layout.js';

describe('merged map layout', () => {
  it('places a system where its source has it, moved down until it covers nothing', () => {
    expect(placeFree({ x: 10, y: 20 }, [])).toEqual({ x: 10, y: 20 });
    expect(placeFree({ x: 10, y: 20 }, [{ x: 0, y: 0 }])).toEqual({ x: 10, y: 164 });
    expect(
      placeFree(null, [
        { x: 0, y: 0 },
        { x: 360, y: 0 },
      ]),
    ).toEqual({ x: 720, y: 0 });
    expect(placeFree(null, [])).toEqual({ x: 0, y: 0 });
  });

  it('keeps a source’s offset to a neighbour already placed', () => {
    // The source has the neighbour at (100, 100) and the system at (460, 100); the merged map
    // already shows the neighbour at (-50, 300).
    expect(besideNeighbour({ x: 460, y: 100 }, { x: 100, y: 100 }, { x: -50, y: 300 })).toEqual({
      x: 310,
      y: 300,
    });
  });

  it('reads positions only when they are positions', () => {
    expect(asPosition({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(asPosition({ x: '1', y: 2 })).toBeNull();
    expect(asPosition(null)).toBeNull();
  });

  describe('clusters of sources in their own coordinate spaces', () => {
    const NODE = { width: 240, height: 100 };
    const overlaps = (a: Extent, b: Extent) =>
      a.minX < b.maxX + NODE.width &&
      b.minX < a.maxX + NODE.width &&
      a.minY < b.maxY + NODE.height &&
      b.minY < a.maxY + NODE.height;
    const move = (e: Extent, by: { x: number; y: number }): Extent => ({
      minX: e.minX + by.x,
      maxX: e.maxX + by.x,
      minY: e.minY + by.y,
      maxY: e.maxY + by.y,
    });

    it('keeps the first cluster where it is', () => {
      expect(clusterOffset(extentOf([{ x: 2640, y: 0 }]), null)).toEqual({ x: 0, y: 0 });
      expect(extentOf([])).toBeNull();
    });

    it('puts the next cluster right of what is shown, top on top, on the grid, never overlapping', () => {
      // Production: a Wanderer intel map far left of the live chain.
      const chain = extentOf([
        { x: 2640, y: 0 },
        { x: 3312, y: 288 },
      ])!;
      const intel = extentOf([
        { x: -3500, y: -2500 },
        { x: 264, y: 1176 },
      ])!;
      const offset = clusterOffset(intel, chain);
      expect(offset.x % 24).toBe(0);
      expect(offset.y % 24).toBe(0);
      const placed = move(intel, offset);
      expect(overlaps(placed, chain)).toBe(false);
      expect(placed.minX).toBeGreaterThanOrEqual(chain.maxX + 2 * 360);
      expect(placed.minX - chain.maxX).toBeLessThan(2 * 360 + 24);
      expect(Math.abs(placed.minY - chain.minY)).toBeLessThan(24);
      // A third cluster goes right of both.
      const both = extentOf([
        { x: chain.minX, y: chain.minY },
        { x: placed.maxX, y: placed.maxY },
      ])!;
      const third = move(extentOf([{ x: 0, y: 0 }])!, clusterOffset(extentOf([{ x: 0, y: 0 }]), both));
      expect(overlaps(third, both)).toBe(false);
      // The same inputs give the same offset (it is also stored, see the merger).
      expect(clusterOffset(intel, chain)).toEqual(offset);
    });

    it('tells systems still where their source has them from moved ones', () => {
      expect(placedAsSourceHasIt({ x: 24, y: 48 }, { x: 24, y: 48 })).toBe(true);
      expect(placedAsSourceHasIt({ x: 24, y: 48 + 2 * 144 }, { x: 24, y: 48 })).toBe(true);
      expect(placedAsSourceHasIt({ x: 48, y: 48 }, { x: 24, y: 48 })).toBe(false);
      expect(placedAsSourceHasIt({ x: 24, y: 0 }, { x: 24, y: 48 })).toBe(false);
      expect(shifted({ x: 1, y: 2 }, { x: 10, y: 20 })).toEqual({ x: 11, y: 22 });
    });
  });
});
