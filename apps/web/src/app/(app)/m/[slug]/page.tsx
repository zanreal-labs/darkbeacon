import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { buildPath, routes, type MapSnapshot, type UniverseSystemDto } from '@darkbeacon/shared';
import { mapKey, mapsKey, meKey } from '../../../../lib/session-keys';
import { universeKey } from '../../../../lib/universe-keys';
import {
  getMapBySlug,
  getMaps,
  getMe,
  getUniverseSystems,
  prefilled,
  serverGet,
} from '../../../../server/api';
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
  // Read together: the account, the map and the list (signed out, the list is never used).
  const maps = getMaps();
  maps.catch(() => {});
  const [me, map] = await Promise.all([getMe(), getMapBySlug(slug)]);
  if (!me) return <SignInRedirect />;
  if (!map) return <MapUnavailable slug={slug} error={null} />;
  const [list, snapshot] = await Promise.all([
    maps,
    serverGet(
      routes.realtime.snapshot,
      buildPath(routes.realtime.snapshot.path, { stream: `map:${map.id}` }),
    ),
  ]);
  // Names and classes of the systems on the map, so the first paint is complete (static data,
  // cached by this server after the first time it is asked).
  const ids = ((snapshot.data as MapSnapshot).systems ?? []).map((s) => s.solarSystemId);
  const universe = ids.length > 0 ? await getUniverseSystems(ids) : new Map<number, UniverseSystemDto>();
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [mapsKey, list],
        [mapKey(slug), map],
        ...ids.map((id) => [universeKey(id), universe.get(id)] as const),
      ])}
    >
      <MapPage slug={slug} snapshot={snapshot} />
    </HydrationBoundary>
  );
}
