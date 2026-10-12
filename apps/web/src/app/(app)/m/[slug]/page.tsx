import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { buildPath, routes, type MapSnapshot } from '@darkbeacon/shared';
import { mapKey, mapsKey, meKey } from '../../../../lib/session-keys';
import { universeKey } from '../../../../lib/universe-keys';
import { getMapBySlug, getMaps, getMe, prefilled, serverFind, serverGet } from '../../../../server/api';
import { MapLoading, MapPage, MapUnavailable } from '../../../../screens/MapPage';
import { SignInRedirect } from '../../../../shell/Session';

/**
 * `/m/<slug>`: the live map. The shell and a loading state are prerendered; the map, its
 * snapshot (with the seq the WebSocket resumes from) and the systems' static data stream in.
 */
export default function MapRoute({ params }: PageProps<'/m/[slug]'>) {
  return (
    <Suspense fallback={<MapLoading />}>
      <LiveMap params={params} />
    </Suspense>
  );
}

async function LiveMap({ params }: Pick<PageProps<'/m/[slug]'>, 'params'>) {
  const { slug } = await params;
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [map, maps] = await Promise.all([getMapBySlug(slug), getMaps()]);
  if (!map) return <MapUnavailable slug={slug} error={null} />;
  const snapshot = await serverGet(
    routes.realtime.snapshot,
    buildPath(routes.realtime.snapshot.path, { stream: `map:${map.id}` }),
  );
  // Names and classes of the systems on the map, so the first paint is complete.
  const ids = ((snapshot.data as MapSnapshot).systems ?? []).map((s) => s.solarSystemId);
  const universe = await Promise.all(
    ids.map((id) =>
      serverFind(routes.universe.getSystem, buildPath(routes.universe.getSystem.path, { solarSystemId: id })),
    ),
  );
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [mapsKey, maps],
        [mapKey(slug), map],
        ...ids.map((id, i) => [universeKey(id), universe[i] ?? undefined] as const),
      ])}
    >
      <MapPage slug={slug} snapshot={snapshot} />
    </HydrationBoundary>
  );
}
