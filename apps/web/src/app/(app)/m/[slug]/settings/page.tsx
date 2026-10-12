import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { HydrationBoundary } from '@tanstack/react-query';
import { mapKey, mapsKey, meKey } from '../../../../../lib/session-keys';
import { mapPermissions } from '../../../../../lib/roles';
import { getMapBySlug, getMaps, getMe, prefilled } from '../../../../../server/api';
import { MapSettingsPage, MapSettingsSkeleton } from '../../../../../screens/MapSettingsPage';
import { SignInRedirect } from '../../../../../shell/Session';

/** `/m/<slug>/settings`: general, labels, access rules and webhooks of a map (managers and up). */
export default function MapSettingsRoute({ params }: PageProps<'/m/[slug]/settings'>) {
  return (
    <Suspense fallback={<MapSettingsSkeleton />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: Pick<PageProps<'/m/[slug]/settings'>, 'params'>) {
  const { slug } = await params;
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [map, maps] = await Promise.all([getMapBySlug(slug), getMaps()]);
  const role = maps.find((m) => m.id === map?.id)?.role;
  if (map && !mapPermissions(role).manage) redirect(`/m/${slug}`);
  return (
    <HydrationBoundary
      state={prefilled([[meKey, me], [mapsKey, maps], ...(map ? [[mapKey(slug), map] as const] : [])])}
    >
      <MapSettingsPage slug={slug} />
    </HydrationBoundary>
  );
}
