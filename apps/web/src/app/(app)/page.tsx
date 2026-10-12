import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { HydrationBoundary } from '@tanstack/react-query';
import { mapsKey, meKey, providersKey } from '../../lib/session-keys';
import { LAST_MAP_COOKIE } from '../../lib/last-map';
import { getMaps, getMe, getProviders, prefilled } from '../../server/api';
import { HomePage, HomePageSkeleton } from '../../screens/HomePage';
import { SignInRedirect } from '../../shell/Session';

/**
 * `/`: the map you work on, not a list. The last map you opened (or your first one) opens straight
 * away; the list of maps lives at `/maps`. Only someone with no map at all stays here, on the
 * screen that creates the first one.
 */
export default function HomeRoute() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <OpenDefaultMap />
    </Suspense>
  );
}

async function OpenDefaultMap() {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [maps, providers, jar] = await Promise.all([getMaps(), getProviders(), cookies()]);
  const last = jar.get(LAST_MAP_COOKIE)?.value;
  const target = maps.find((m) => m.slug === last) ?? maps[0];
  if (target) redirect(`/m/${encodeURIComponent(target.slug)}`);
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [mapsKey, maps],
        [providersKey, providers],
      ])}
    >
      <HomePage />
    </HydrationBoundary>
  );
}
