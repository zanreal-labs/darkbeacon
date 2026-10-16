import { describe, expect, it } from 'vitest';
import {
  MINIMAP_SIZE,
  MINIMAP_SPAN,
  minimapProjection,
  toFlow,
  toMinimap,
  viewFrame,
  viewportCenteredOn,
} from './minimapProjection';

const pane = { width: 1000, height: 700 };

describe('minimap projection', () => {
  it('puts the middle of the view in the middle of the minimap, wherever the view is', () => {
    for (const viewport of [
      { x: 0, y: 0, zoom: 1 },
      { x: -4200, y: 1300, zoom: 0.4 },
      { x: 900, y: -250, zoom: 1.8 },
    ]) {
      const p = minimapProjection(viewport, pane);
      expect(toMinimap(p.center, p)).toEqual({ x: MINIMAP_SIZE.width / 2, y: MINIMAP_SIZE.height / 2 });
      const frame = viewFrame(pane, p, viewport.zoom);
      expect(frame.x + frame.width / 2).toBeCloseTo(MINIMAP_SIZE.width / 2);
      expect(frame.y + frame.height / 2).toBeCloseTo(MINIMAP_SIZE.height / 2);
    }
  });

  it('keeps the frame the same size at any zoom: a fixed share of the minimap', () => {
    for (const zoom of [0.3, 1, 2]) {
      const frame = viewFrame(pane, minimapProjection({ x: 10, y: 20, zoom }, pane), zoom);
      expect(frame.width).toBeCloseTo(MINIMAP_SIZE.width / MINIMAP_SPAN);
      expect(frame.height).toBeCloseTo((MINIMAP_SIZE.width / MINIMAP_SPAN) * (pane.height / pane.width));
    }
  });

  it('scales with the zoom, and minimap and flow points round-trip', () => {
    const p = minimapProjection({ x: -300, y: 120, zoom: 2 }, pane);
    expect(p.scale).toBeCloseTo((2 * MINIMAP_SIZE.width) / (MINIMAP_SPAN * pane.width));
    const flow = { x: 1234, y: -567 };
    const m = toMinimap(flow, p);
    expect(toFlow(m, p).x).toBeCloseTo(flow.x);
    expect(toFlow(m, p).y).toBeCloseTo(flow.y);
    // Ten minimap pixels are ten over the scale in flow units.
    expect(toFlow({ x: m.x + 10, y: m.y }, p).x - flow.x).toBeCloseTo(10 / p.scale);
  });

  it('centres a viewport on a point', () => {
    const v = viewportCenteredOn({ x: 500, y: -80 }, 1.5, pane);
    expect(minimapProjection(v, pane).center).toEqual({ x: 500, y: -80 });
    expect(v.zoom).toBe(1.5);
  });
});
