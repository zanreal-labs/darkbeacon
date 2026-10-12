'use client';

import dynamic from 'next/dynamic';
import { rememberLastMap } from '../lib/last-map';
import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import {
  buildPath,
  routes,
  type MapDto,
  type MapSummaryDto,
  type StreamSnapshotDto,
} from '@darkbeacon/shared';
import { Lock } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useBreadcrumbs } from '../shell/breadcrumbs';
import { Button, EmptyState, ErrorState, Spinner } from '../ui';
import styles from './MapPage.module.css';

/** What the map page shows until the canvas is ready; also the server's Suspense fallback. */
export function MapLoading({ label = 'Loading map…' }: { label?: string }) {
  return (
    <div className={styles.page} data-immersive>
      <div className={styles.center} role="status">
        <Spinner label={label} />
        <span>{label}</span>
      </div>
    </div>
  );
}

// React Flow measures the browser window, so the canvas renders in the browser only; until its
// code arrived the page shows the same loading state as the streamed shell.
const MapView = dynamic(() => import('./MapView').then((m) => m.MapView), {
  ssr: false,
  loading: () => <MapLoading label="Loading systems…" />,
});

/**
 * `/m/<slug>`: the server renders it with the map, the visitor's role and a snapshot of the map's
 * stream; the canvas paints that snapshot at once and the WebSocket resumes after its seq.
 */
export function MapPage({ slug, snapshot }: { slug: string; snapshot?: StreamSnapshotDto }) {
  const map = useQuery({
    queryKey: ['map', slug],
    queryFn: () => api<MapDto>(buildPath(routes.maps.bySlug.path, { slug })),
    retry: false,
  });
  const maps = useQuery({
    queryKey: ['maps'],
    queryFn: () => api<MapSummaryDto[]>(routes.maps.list.path),
    retry: false,
  });
  useBreadcrumbs([{ label: 'Maps', to: '/maps' }, { label: map.data?.name ?? slug }]);
  // `/` reopens this map next time.
  useEffect(() => {
    if (map.isSuccess) rememberLastMap(map.data.slug);
  }, [map.isSuccess, map.data?.slug]);

  if (map.isPending) return <MapLoading />;
  if (map.isError) return <MapUnavailable slug={slug} error={map.error} onRetry={() => void map.refetch()} />;
  const role = maps.data?.find((m) => m.id === map.data.id)?.role ?? 'viewer';
  return (
    <ReactFlowProvider>
      <MapView
        key={map.data.id}
        map={map.data}
        role={role}
        snapshot={snapshot?.stream === `map:${map.data.id}` ? snapshot : undefined}
      />
    </ReactFlowProvider>
  );
}

export function MapUnavailable({
  slug,
  error,
  onRetry,
}: {
  slug: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const missing = error === null || (error instanceof ApiError && error.status === 404);
  return (
    <div className={styles.page} data-immersive>
      <div className={styles.overlayCard}>
        {missing ? (
          <EmptyState
            icon={<Lock />}
            title="Map not found"
            description={`There is no map “${slug}”, or you have no access to it. Ask its admin to add you.`}
            actions={
              <Button asChild variant="primary">
                <Link href="/maps">Back to maps</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title="The map could not be loaded" error={error} onRetry={onRetry} />
        )}
      </div>
    </div>
  );
}
