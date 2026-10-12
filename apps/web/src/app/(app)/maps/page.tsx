import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { instanceKey, mapsKey, meKey, providersKey } from '../../../lib/session-keys';
import { getInstance, getMaps, getMe, getProviders, prefilled } from '../../../server/api';
import { MapsPage, MapsPageSkeleton } from '../../../screens/HomePage';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'All maps · Darkbeacon' };

/** `/maps` ("All maps" in the map switcher): every map, starring the one `/` opens. */
export default function MapsRoute() {
  return (
    <Suspense fallback={<MapsPageSkeleton />}>
      <Maps />
    </Suspense>
  );
}

async function Maps() {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [maps, providers, instance] = await Promise.all([getMaps(), getProviders(), getInstance()]);
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [mapsKey, maps],
        [providersKey, providers],
        [instanceKey, instance],
      ])}
    >
      <MapsPage />
    </HydrationBoundary>
  );
}
