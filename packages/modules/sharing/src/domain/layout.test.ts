import { describe, expect, it } from 'vitest';
import { asPosition, besideNeighbour, placeFree } from './layout.js';

describe('merged map layout', () => {
  it('places a system where its source has it, else by the map placement rule', () => {
    const placed = (...spots: Array<[number, number, number]>) =>
      new Map(spots.map(([id, x, y]) => [id, { x, y }]));
    // Where the source has it, when free.
    expect(placeFree({ x: 10, y: 20 }, placed())).toEqual({ x: 10, y: 20 });
    // Taken: the nearest free slot, below first, in line with the system in the way.
    expect(placeFree({ x: 10, y: 20 }, placed([1, 0, 0]))).toEqual({ x: 0, y: 144 });
    // Next to a neighbour already placed, in the chain's direction.
    expect(placeFree({ x: 10, y: 20 }, placed([1, 0, 0]), [], 1)).toEqual({ x: 360, y: 0 });
    // Nowhere to start from: below the system placed last, never at the far right.
    expect(placeFree(null, placed([1, 0, 0], [2, 360, 0]))).toEqual({ x: 360, y: 144 });
    expect(placeFree(null, placed())).toEqual({ x: 0, y: 0 });
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
});
