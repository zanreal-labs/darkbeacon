import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '../../../lib/api';
import { getPublicMap } from '../../../server/public-map';
import {
  PublicMapGone,
  PublicMapLoading,
  PublicMapScreen,
  PublicMapUnavailable,
} from '../../../screens/PublicMapScreen';

/**
 * `/p/<token>`: a map someone made public, read-only and live, for anyone with the link. No app
 * shell and no session: the view is read without the visitor's cookies, and the proxy never signs
 * a visit here in. Search engines are asked to stay away when the map says so, and the address
 * (which is the secret) never leaves as a referrer.
 */
export async function generateMetadata({ params }: PageProps<'/p/[token]'>): Promise<Metadata> {
  const { token } = await params;
  const view = await getPublicMap(token).catch(() => null);
  return {
    title: view ? `${view.map.name} · Darkbeacon` : 'Darkbeacon',
    referrer: 'no-referrer',
    robots: !view || view.map.noindex ? { index: false, follow: false } : undefined,
  };
}

export default function PublicMapRoute({ params }: PageProps<'/p/[token]'>) {
  return (
    <Suspense fallback={<PublicMapLoading />}>
      <PublicMap params={params} />
    </Suspense>
  );
}

async function PublicMap({ params }: Pick<PageProps<'/p/[token]'>, 'params'>) {
  const { token } = await params;
  const read = await getPublicMap(token).then(
    (view) => ({ view, error: null }),
    (error: unknown) => ({ view: null, error }),
  );
  if (read.error) {
    const busy = read.error instanceof ApiError && read.error.status === 429;
    return (
      <PublicMapUnavailable
        message={
          busy
            ? 'Too many visits from your address right now. Wait a minute and try again.'
            : 'The server did not answer. Try again in a moment.'
        }
      />
    );
  }
  if (!read.view) return <PublicMapGone />;
  return <PublicMapScreen token={token} view={read.view} />;
}
