import { describe, expect, it } from 'vitest';
import { asPosition, besideNeighbour, placeFree } from './layout.js';

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
});
