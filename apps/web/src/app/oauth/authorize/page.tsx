import { Suspense } from 'react';
import type { Metadata } from 'next';
import { OAuthAuthorizeQuery, routes } from '@darkbeacon/shared';
import { ApiError } from '../../../lib/api';
import { getMaps, getMe, serverGet } from '../../../server/api';
import { OAuthConsent, OAuthConsentError } from '../../../screens/OAuthConsent';
import { SignInRedirect } from '../../../shell/Session';
import { Spinner } from '../../../ui';

export const metadata: Metadata = {
  title: 'Allow access · Darkbeacon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** The OAuth fields the consent page passes on; anything else in the address is ignored. */
const FIELDS = Object.keys(OAuthAuthorizeQuery.shape) as (keyof OAuthAuthorizeQuery)[];

/**
 * `/oauth/authorize`: the consent page of the MCP endpoint's OAuth flow. It needs a session: the
 * proxy sends a signed-out visit to sign-in with the whole address as `next` (or signs it in on a
 * demo instance), so the person lands back here with the same request.
 */
export default function OAuthAuthorizeRoute({ searchParams }: PageProps<'/oauth/authorize'>) {
  return (
    <Suspense
      fallback={
        <main style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
          <Spinner label="Loading" />
        </main>
      }
    >
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}

async function Consent({ searchParams }: Pick<PageProps<'/oauth/authorize'>, 'searchParams'>) {
  const params = await searchParams;
  const fields: Record<string, string> = {};
  for (const key of FIELDS) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') fields[key] = first;
  }
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const read = await Promise.all([
    serverGet(routes.oauth.describe, `${routes.oauth.describe.path}?${new URLSearchParams(fields)}`),
    getMaps(),
  ]).then(
    ([request, maps]) => ({ request, maps, error: null }),
    (error: unknown) => ({ request: null, maps: null, error }),
  );
  if (read.error instanceof ApiError && read.error.status === 401) return <SignInRedirect />;
  const query = OAuthAuthorizeQuery.safeParse(fields);
  if (!read.request || !read.maps || !query.success) {
    const message =
      read.error instanceof ApiError
        ? read.error.message.replace(/\.?$/, '.')
        : 'The request is missing something the app should have sent.';
    return <OAuthConsentError message={message} />;
  }
  return (
    <OAuthConsent query={query.data} request={read.request} maps={read.maps} accountName={me.account.name} />
  );
}
