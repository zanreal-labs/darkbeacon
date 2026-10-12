'use client';

import { useEffect, useId } from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import { Focus, Info, Maximize, Minus, Plus } from 'lucide-react';
import { IconButton } from '../ui';
import { MapLegend } from './MapLegend';
import styles from './MapControls.module.css';

interface Props {
  onFit(): void;
  onFitSelection(): void;
  hasSelection: boolean;
  legend: boolean;
  onLegend(open: boolean): void;
}

/** Zoom, fit the map, fit the selection and the connection legend, bottom left of the canvas. */
export function MapControls({ onFit, onFitSelection, hasSelection, legend, onLegend }: Props) {
  const rf = useReactFlow();
  const legendId = useId();

  useEffect(() => {
    if (!legend) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onLegend(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [legend, onLegend]);

  return (
    <Panel position="bottom-left" className={styles.panel}>
      <div className={styles.bar} role="toolbar" aria-label="Map view" aria-orientation="vertical">
        <IconButton
          tooltipSide="right"
          size="sm"
          className={styles.zoom}
          label="Zoom in"
          icon={<Plus />}
          onClick={() => void rf.zoomIn({ duration: 150 })}
        />
        <IconButton
          tooltipSide="right"
          size="sm"
          className={styles.zoom}
          label="Zoom out"
          icon={<Minus />}
          onClick={() => void rf.zoomOut({ duration: 150 })}
        />
        <span className={styles.divider} aria-hidden />
        <IconButton tooltipSide="right" size="sm" label="Fit the map" icon={<Maximize />} onClick={onFit} />
        <IconButton
          tooltipSide="right"
          size="sm"
          label="Fit the selection"
          icon={<Focus />}
          disabled={!hasSelection}
          onClick={onFitSelection}
        />
        <span className={styles.divider} aria-hidden />
        <IconButton
          tooltipSide="right"
          size="sm"
          label={legend ? 'Hide the legend' : 'Show the legend'}
          icon={<Info />}
          aria-expanded={legend}
          aria-controls={legend ? legendId : undefined}
          data-active={legend || undefined}
          onClick={() => onLegend(!legend)}
        />
      </div>
      {legend && <MapLegend id={legendId} />}
    </Panel>
  );
}
