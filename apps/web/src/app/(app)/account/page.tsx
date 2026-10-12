import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { meKey, providersKey } from '../../../lib/session-keys';
import { getMe, getProviders, prefilled } from '../../../server/api';
import { AccountPage, AccountPageSkeleton } from '../../../screens/AccountPage';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'Account · Darkbeacon' };

/** `/account`: sign-in, EVE characters, appearance and sessions. */
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
  const [providers, query] = await Promise.all([getProviders(), searchParams]);
  // EVE SSO failures come back as ?auth_error=<message>.
  const authError = typeof query.auth_error === 'string' ? query.auth_error : null;
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [providersKey, providers],
      ])}
    >
      <AccountPage authError={authError} />
    </HydrationBoundary>
  );
}
