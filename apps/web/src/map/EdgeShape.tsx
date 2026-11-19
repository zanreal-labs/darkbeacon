import type { CSSProperties } from 'react';
import { edgeInnerStyle, edgeOuterStyle, edgeOuterWidth, type EdgeVisual } from './edgeStyle';
import type { EdgeCurve } from './edgePath';
import styles from './ConnectionEdge.module.css';

/**
 * Bubble ring radius. The ring is centred on the end of the line at the bubbled system and drawn
 * in the edge layer, so the system card covers its inner half: what shows is a dashed arc hugging
 * that side of the card, like a warp disruption bubble around the gate you land on.
 */
export const BUBBLE_RADIUS = 24;

/**
 * The drawn layers of one connection, bottom up: the danger halo, the hover and selection
 * underlay, the outer (time) layer, the core (mass) and the bubbles. The map's edges and the
 * legend's samples both draw with it, so the legend always shows what the map shows.
 */
export function EdgeShape({
  curve,
  visual,
  lineClassName,
  bubbleTitle,
}: {
  curve: EdgeCurve;
  visual: EdgeVisual;
  /** Extra class of the outer layer (React Flow's edge path class on the map). */
  lineClassName?: string;
  bubbleTitle?(end: 'source' | 'target'): string;
}) {
  const { path } = curve;
  const inner = edgeInnerStyle(visual);
  return (
    <g style={{ '--edge-outer': edgeOuterWidth(visual) } as CSSProperties}>
      {visual.halo && <path d={path} className={styles.halo} data-underlay="dangerous" />}
      <path d={path} className={styles.highlight} data-underlay="highlight" />
      <path
        d={path}
        fill="none"
        className={lineClassName ? `${styles.line} ${lineClassName}` : styles.line}
        style={edgeOuterStyle(visual)}
        data-line
      />
      {inner && <path d={path} fill="none" className={styles.core} style={inner} data-layer="mass" />}
      {visual.bubbles.map((end) => {
        const at = end === 'source' ? curve.from : curve.to;
        return (
          <circle key={end} className={styles.bubble} data-bubble={end} cx={at.x} cy={at.y} r={BUBBLE_RADIUS}>
            {bubbleTitle && <title>{bubbleTitle(end)}</title>}
          </circle>
        );
      })}
    </g>
  );
}
