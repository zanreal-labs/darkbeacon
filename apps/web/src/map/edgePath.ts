import { getBezierPath, Position } from '@xyflow/react';
import { sideEnds, type Point, type Rect, type Side } from './geometry';

const POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** A connection's drawn route: the SVG path, its two ends and the middle of the curve. */
export interface EdgeCurve {
  path: string;
  from: Point;
  to: Point;
  /** Halfway along the curve, where the size letter sits. */
  mid: Point;
}

/**
 * The smooth curve between two ends, leaving each at a right angle to its side of the card, as
 * Wanderer draws connections (React Flow's bezier with its default curvature).
 */
export function curveBetween(from: Point, fromSide: Side, to: Point, toSide: Side): EdgeCurve {
  const [path, x, y] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: POSITION[fromSide],
    targetX: to.x,
    targetY: to.y,
    targetPosition: POSITION[toSide],
  });
  return { path, from, to, mid: { x, y } };
}

/** The curve of a connection between two system cards, from the middles of their facing sides. */
export function edgeCurve(source: Rect, target: Rect): EdgeCurve {
  const { from, to, fromSide, toSide } = sideEnds(source, target);
  return curveBetween(from, fromSide, to, toSide);
}
