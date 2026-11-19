import { describe, expect, it } from 'vitest';
import { boundsOf, fitViewport, sideEnds } from './geometry';

const screen = { width: 1000, height: 600 };
const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe('fitViewport', () => {
  it('centres content that fits, never zooming in past the maximum', () => {
    expect(
      fitViewport({ x: 0, y: 0, width: 100, height: 100 }, screen, none, { minZoom: 0.5, maxZoom: 1 }),
    ).toEqual({ x: 450, y: 250, zoom: 1 });
  });

  it('zooms out to fit, inside the padding', () => {
    const v = fitViewport(
      { x: 0, y: 0, width: 1600, height: 400 },
      screen,
      { top: 100, right: 200, bottom: 100, left: 0 },
      { minZoom: 0.2, maxZoom: 1 },
    );
    expect(v.zoom).toBe(0.5);
    // The content's middle (800, 200) lands in the middle of the padded area (400, 300).
    expect(v.x + 800 * v.zoom).toBe(400);
    expect(v.y + 200 * v.zoom).toBe(300);
  });

  it('stays at the readable minimum, centred on the anchor, when the content is too large', () => {
    const v = fitViewport({ x: 0, y: 0, width: 5000, height: 400 }, screen, none, {
      minZoom: 0.8,
      maxZoom: 1,
      anchor: { x: 300, y: 100 },
    });
    expect(v.zoom).toBe(0.8);
    expect(v.x + 300 * 0.8).toBe(500);
    expect(v.y + 100 * 0.8).toBe(300);
  });
});

describe('boundsOf', () => {
  it('wraps all rectangles', () => {
    expect(
      boundsOf([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: -40, y: 60, width: 20, height: 80 },
      ]),
    ).toEqual({ x: -40, y: 20, width: 150, height: 120 });
    expect(boundsOf([])).toBeNull();
  });
});

describe('sideEnds', () => {
  const card = (x: number, y: number) => ({ x, y, width: 200, height: 80 });

  it('joins cards side by side from the middles of their facing sides, whichever is the source', () => {
    expect(sideEnds(card(0, 0), card(360, 150))).toEqual({
      from: { x: 200, y: 40 },
      to: { x: 360, y: 190 },
      fromSide: 'right',
      toSide: 'left',
    });
    expect(sideEnds(card(360, 150), card(0, 0))).toMatchObject({ fromSide: 'left', toSide: 'right' });
  });

  it('joins cards above each other top to bottom, also when they are nearly in line', () => {
    expect(sideEnds(card(0, 0), card(100, 300))).toEqual({
      from: { x: 100, y: 80 },
      to: { x: 200, y: 300 },
      fromSide: 'bottom',
      toSide: 'top',
    });
    // 10 px apart sideways still counts as stacked; 11 px does not.
    expect(sideEnds(card(0, 300), card(210, 0))).toMatchObject({ fromSide: 'top', toSide: 'bottom' });
    expect(sideEnds(card(0, 300), card(211, 0))).toMatchObject({ fromSide: 'right', toSide: 'left' });
  });
});
