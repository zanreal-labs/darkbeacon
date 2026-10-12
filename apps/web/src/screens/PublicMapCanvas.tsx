'use client';

import { ReactFlowProvider } from '@xyflow/react';
import type { LabelDto, SystemLabelDto, UniverseSystemDto } from '@darkbeacon/shared';
import { mapPermissions } from '../lib/roles';
import { MapCanvas } from '../map/MapCanvas';
import type { MapState } from '../map/mapState';

const VIEWER = mapPermissions('viewer');
/** Nothing on a public view changes the map; the canvas never calls these in read-only mode. */
const NO_EDITS = {
  moveSystems: () => Promise.resolve(false),
  addConnection: () => Promise.resolve(false),
};
const nothing = () => {};

/** The map canvas, read-only, for `/p/<token>`. Browser only (React Flow). */
export function PublicMapCanvas({
  mapId,
  state,
  labels,
  systemLabels = [],
  universe,
}: {
  mapId: string;
  state: MapState;
  labels: LabelDto[];
  systemLabels?: SystemLabelDto[];
  universe: Map<number, UniverseSystemDto>;
}) {
  return (
    <ReactFlowProvider>
      <MapCanvas
        mapId={mapId}
        state={state}
        loaded
        labels={labels}
        systemLabels={systemLabels}
        universe={universe}
        can={VIEWER}
        store={NO_EDITS}
        onSelect={nothing}
        focus={null}
        onMenu={nothing}
        readOnly
      />
    </ReactFlowProvider>
  );
}
