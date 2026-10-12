import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { routes } from '@darkbeacon/shared';
import { meKey, myTrackingKey, providersKey } from '../../../lib/session-keys';
import { getMe, getProviders, prefilled, serverGet } from '../../../server/api';
import { CharactersPage, CharactersPageSkeleton } from '../../../screens/CharactersPage';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'Characters · Darkbeacon' };

/** `/characters`: my characters, where they are, their scopes and the maps that track them. */
export default function CharactersRoute({ searchParams }: PageProps<'/characters'>) {
  return (
    <Suspense fallback={<CharactersPageSkeleton />}>
      <Characters searchParams={searchParams} />
    </Suspense>
  );
}

async function Characters({ searchParams }: Pick<PageProps<'/characters'>, 'searchParams'>) {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [providers, tracking, query] = await Promise.all([
    getProviders(),
    serverGet(routes.characters.myTracking).catch(() => undefined),
    searchParams,
  ]);
  // EVE SSO failures come back as ?auth_error=<message>.
  const authError = typeof query.auth_error === 'string' ? query.auth_error : null;
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [providersKey, providers],
        [myTrackingKey, tracking],
      ])}
    >
      <CharactersPage authError={authError} />
    </HydrationBoundary>
  );
}
