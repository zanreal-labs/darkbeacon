'use client';

import { useEffect, useId, useState } from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { buildPath, routes, type MapDto } from '@darkbeacon/shared';
import { Bookmark, Info, LocateFixed, Maximize, Minus, Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { MapPermissions } from '../lib/roles';
import { Dialog, DialogContent, IconButton } from '../ui';
import { BookmarkLabelSettings } from './BookmarkSettings';
import { MapLegend } from './MapLegend';
import styles from './MapControls.module.css';

interface Props {
  mapId: string;
  can: MapPermissions;
  /** Fit the whole chain (F). */
  onFit(): void;
  /** Center on my character (C). */
  onCenterMe(): void;
  /** One of my characters is on the map. */
  located: boolean;
  legend: boolean;
  onLegend(open: boolean): void;
}

function BookmarkDialog({ mapId, can }: { mapId: string; can: MapPermissions }) {
  const map = useQuery({
    queryKey: ['map-by-id', mapId],
    queryFn: () => api<MapDto>(buildPath(routes.maps.get.path, { mapId })),
    staleTime: 0,
  });
  return (
    <DialogContent
      title="Bookmark labels"
      description="The short label above each system, ready to paste into your in-game bookmark."
      width={640}
    >
      {map.data ? <BookmarkLabelSettings map={map.data} canManage={can.manage} /> : null}
    </DialogContent>
  );
}

/** Zoom, fit the chain, center on me, bookmark labels and the legend, bottom left of the canvas. */
export function MapControls({ mapId, can, onFit, onCenterMe, located, legend, onLegend }: Props) {
  const rf = useReactFlow();
  const legendId = useId();
  const [labels, setLabels] = useState(false);

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
        <IconButton tooltipSide="right" size="sm" label="Fit chain (F)" icon={<Maximize />} onClick={onFit} />
        <IconButton
          tooltipSide="right"
          size="sm"
          label="Center on me (C)"
          icon={<LocateFixed />}
          data-muted={!located || undefined}
          onClick={onCenterMe}
        />
        <span className={styles.divider} aria-hidden />
        <Dialog open={labels} onOpenChange={setLabels}>
          <IconButton
            tooltipSide="right"
            size="sm"
            label="Bookmark labels"
            icon={<Bookmark />}
            onClick={() => setLabels(true)}
          />
          {labels && <BookmarkDialog mapId={mapId} can={can} />}
        </Dialog>
        <IconButton
          tooltipSide="right"
          size="sm"
          label={legend ? 'Hide the legend (L)' : 'Show the legend (L)'}
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
