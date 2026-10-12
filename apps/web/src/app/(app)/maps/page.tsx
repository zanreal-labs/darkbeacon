import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { mapsKey, meKey, providersKey } from '../../../lib/session-keys';
import { getMaps, getMe, getProviders, prefilled } from '../../../server/api';
import { HomePage, HomePageSkeleton } from '../../../screens/HomePage';
import { SignInRedirect } from '../../../shell/Session';

/** `/maps`: the maps you can see. The heading is prerendered; the list streams in. */
export default function MapsRoute() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <Maps />
    </Suspense>
  );
}

async function Maps() {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [maps, providers] = await Promise.all([getMaps(), getProviders()]);
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
