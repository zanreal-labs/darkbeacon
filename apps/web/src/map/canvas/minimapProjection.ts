/**
 * The minimap's maths. The view sits in the middle of the minimap at a fixed size; the minimap
 * shows MINIMAP_SPAN view widths (and heights) around it, so the chain moves and scales under
 * the frame as the map is panned and zoomed.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The minimap box, in screen pixels (matches canvas.module.css). */
export const MINIMAP_SIZE: Size = { width: 200, height: 140 };

/** How many views fit across the minimap, each way. */
export const MINIMAP_SPAN = 4;

export interface Projection {
  /** The flow point in the middle of the view, and so of the minimap. */
  center: Point;
  /** Minimap pixels per flow unit. */
  scale: number;
  box: Size;
}

export function minimapProjection(
  viewport: Viewport,
  pane: Size,
  box: Size = MINIMAP_SIZE,
  span: number = MINIMAP_SPAN,
): Projection {
  const width = Math.max(pane.width, 1);
  const height = Math.max(pane.height, 1);
  return {
    center: {
      x: (width / 2 - viewport.x) / viewport.zoom,
      y: (height / 2 - viewport.y) / viewport.zoom,
    },
    // The view is width / zoom flow units wide; span of those fill the box.
    scale: viewport.zoom * Math.min(box.width / (span * width), box.height / (span * height)),
    box,
  };
}

/** A flow point to a minimap point. */
export function toMinimap(p: Point, { center, scale, box }: Projection): Point {
  return { x: box.width / 2 + (p.x - center.x) * scale, y: box.height / 2 + (p.y - center.y) * scale };
}

/** A minimap point to a flow point. */
export function toFlow(m: Point, { center, scale, box }: Projection): Point {
  return { x: center.x + (m.x - box.width / 2) / scale, y: center.y + (m.y - box.height / 2) / scale };
}

/** The view's frame on the minimap: always centred, the same size at any zoom. */
export function viewFrame(pane: Size, projection: Projection, zoom: number) {
  const width = (Math.max(pane.width, 1) / zoom) * projection.scale;
  const height = (Math.max(pane.height, 1) / zoom) * projection.scale;
  return {
    x: (projection.box.width - width) / 2,
    y: (projection.box.height - height) / 2,
    width,
    height,
  };
}

/** The viewport that puts a flow point in the middle of the pane at a zoom. */
export function viewportCenteredOn(p: Point, zoom: number, pane: Size): Viewport {
  return { x: pane.width / 2 - p.x * zoom, y: pane.height / 2 - p.y * zoom, zoom };
}
