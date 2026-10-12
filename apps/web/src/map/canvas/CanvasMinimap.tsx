'use client';

import { MiniMap } from '@xyflow/react';
import type { Corner } from './prefs';
import styles from './canvas.module.css';

/**
 * The minimap in the corner the viewer chose: the chain as plain blocks, the view as a frame;
 * drag or wheel on it to move around. Kept clear of the top bar, the view controls and the panel.
 */
export function CanvasMinimap({ corner }: { corner: Corner }) {
  return (
    <MiniMap
      position={corner}
      className={styles.minimap}
      data-corner={corner}
      pannable
      zoomable
      ariaLabel="Minimap"
      nodeBorderRadius={4}
      nodeStrokeWidth={0}
      nodeColor="var(--dbk-color-text-subtle)"
      maskColor="color-mix(in oklab, var(--dbk-color-canvas) 70%, transparent)"
      maskStrokeColor="var(--dbk-color-accent)"
      maskStrokeWidth={2}
      bgColor="var(--dbk-color-surface)"
    />
  );
}
