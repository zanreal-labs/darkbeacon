import { describe, expect, it } from 'vitest';
import { GUTTER, sideCover } from './layout';

const area = { width: 1600, height: 900 };

describe('what the widget windows cover of the map', () => {
  it('is the docked column on the right, as far in and down as it reaches', () => {
    const column = [
      { x: 1240, y: 10, w: 350, h: 300 },
      { x: 1240, y: 320, w: 350, h: 200 },
    ];
    expect(sideCover(column, area)).toEqual({ left: 0, right: 360 + GUTTER, rightBottom: 520 + GUTTER });
  });

  it('counts windows dragged to the left from the left edge', () => {
    const left = [
      { x: 20, y: 40, w: 320, h: 400 },
      { x: 300, y: 300, w: 400, h: 200 },
    ];
    expect(sideCover(left, area)).toEqual({ left: 700 + GUTTER, right: 0, rightBottom: 0 });
  });

  it('keeps room in the middle: covers that leave too little keep the larger side only', () => {
    const both = [
      { x: 0, y: 0, w: 700, h: 300 },
      { x: 820, y: 0, w: 780, h: 300 },
    ];
    expect(sideCover(both, area)).toEqual({ left: 0, right: 780 + GUTTER, rightBottom: 300 + GUTTER });
    expect(sideCover([], area)).toEqual({ left: 0, right: 0, rightBottom: 0 });
  });
});
