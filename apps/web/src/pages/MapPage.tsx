import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildPath, routes, type MapDto } from '@wormwright/shared';
import { api } from '../lib/api';
import { useStream } from '../lib/RealtimeProvider';
import { applyMapMessage, emptyMapState } from '../map/mapState';
import styles from './MapPage.module.css';

export function MapPage() {
  const { slug = '' } = useParams();
  const map = useQuery({
    queryKey: ['map', slug],
    queryFn: () => api<MapDto>(buildPath(routes.maps.bySlug.path, { slug })),
    retry: false,
  });
  const [state, setState] = useState(emptyMapState);
  useStream(map.data ? `map:${map.data.id}` : null, (message) =>
    setState((s) => applyMapMessage(s, message)),
  );

  const nodes = useMemo<Node[]>(
    () =>
      [...state.systems.values()].map((s) => ({
        id: String(s.solarSystemId),
        position: s.position,
        data: { label: s.customName ?? s.temporaryName ?? String(s.solarSystemId) },
      })),
    [state.systems],
  );
  const edges = useMemo<Edge[]>(
    () =>
      [...state.connections.values()].map((c) => ({
        id: c.id,
        source: String(c.source),
        target: String(c.target),
      })),
    [state.connections],
  );

  return (
    <div className={styles.page}>
      {map.isError && <p className={styles.notice}>Map “{slug}” is not available.</p>}
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
