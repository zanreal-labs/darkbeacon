import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { providersKey } from '../../lib/session-keys';
import { safeNext } from '../../lib/safe-next';
import { getProviders, prefilled } from '../../server/api';
import { LoginActions, LoginActionsSkeleton, LoginScreen } from '../../screens/LoginPage';

export const metadata = { title: 'Sign in · Darkbeacon' };

/** `/login`: the page itself is prerendered; the ways in stream in. */
export default function LoginRoute({ searchParams }: PageProps<'/login'>) {
  return (
    <LoginScreen
      actions={
        <Suspense fallback={<LoginActionsSkeleton />}>
          <Actions searchParams={searchParams} />
        </Suspense>
      }
    />
  );
}

async function Actions({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === 'string' ? query.next : null);
  // Someone signed in never gets here: the proxy sends them on to `next`.
  const providers = await getProviders();
  return (
    <HydrationBoundary state={prefilled([[providersKey, providers]])}>
      <LoginActions
        providers={providers}
        next={next}
        authError={typeof query.auth_error === 'string' ? query.auth_error : null}
        invite={typeof query.invite === 'string' ? query.invite : null}
      />
    </HydrationBoundary>
  );
}
