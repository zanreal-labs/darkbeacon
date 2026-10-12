import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { routes } from '@darkbeacon/shared';
import { mapsKey, meKey, presenceSettingsKey, providersKey, sessionsKey } from '../../../lib/session-keys';
import { getMaps, getMe, getProviders, prefilled, serverGet } from '../../../server/api';
import { AccountPage, AccountPageSkeleton } from '../../../screens/AccountPage';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'Account · Darkbeacon' };

/** `/account`: sign-in, EVE characters, the map that opens first, appearance, live cursors and sessions. */
export default function AccountRoute({ searchParams }: PageProps<'/account'>) {
  return (
    <Suspense fallback={<AccountPageSkeleton />}>
      <Account searchParams={searchParams} />
    </Suspense>
  );
}

async function Account({ searchParams }: Pick<PageProps<'/account'>, 'searchParams'>) {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [providers, maps, sessions, presence, query] = await Promise.all([
    getProviders(),
    getMaps(),
    serverGet(routes.accounts.sessions).catch(() => undefined),
    serverGet(routes.presence.settings).catch(() => undefined),
    searchParams,
  ]);
  // EVE SSO and Discord failures come back as ?auth_error=<message>.
  const authError = typeof query.auth_error === 'string' ? query.auth_error : null;
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [providersKey, providers],
        [mapsKey, maps],
        [sessionsKey, sessions],
        [presenceSettingsKey, presence],
      ])}
    >
      <AccountPage authError={authError} />
    </HydrationBoundary>
  );
}
