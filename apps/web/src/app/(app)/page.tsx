import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { HydrationBoundary } from '@tanstack/react-query';
import { meKey, providersKey } from '../../lib/session-keys';
import { getLanding, getMe, getProviders, prefilled } from '../../server/api';
import { FirstMapPage, LandingSkeleton } from '../../screens/HomePage';
import { SignInRedirect } from '../../shell/Session';

/**
 * `/`: the map this account opens (its star, the instance default, the last opened, the only
 * one). The proxy redirects before any HTML; this is the fallback, and the first-map screen
 * when the account can see no map yet.
 */
export default function LandingRoute() {
  return (
    <Suspense fallback={<LandingSkeleton />}>
      <Landing />
    </Suspense>
  );
}

async function Landing() {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [landing, providers] = await Promise.all([getLanding(), getProviders()]);
  if (landing.slug) redirect(`/m/${encodeURIComponent(landing.slug)}`);
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [providersKey, providers],
      ])}
    >
      <FirstMapPage />
    </HydrationBoundary>
  );
}
