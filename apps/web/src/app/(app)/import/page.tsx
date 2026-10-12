import { Suspense } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { mapsKey, meKey } from '../../../lib/session-keys';
import { getMaps, getMe, prefilled } from '../../../server/api';
import { ImportPage, ImportPageSkeleton } from '../../../screens/ImportPage';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'Import from Wanderer · Darkbeacon' };

/** `/import` (All maps) and `/import?into=<slug>` (a map's settings): import a Wanderer map. */
export default function ImportRoute({ searchParams }: PageProps<'/import'>) {
  return (
    <Suspense fallback={<ImportPageSkeleton />}>
      <Import searchParams={searchParams} />
    </Suspense>
  );
}

async function Import({ searchParams }: Pick<PageProps<'/import'>, 'searchParams'>) {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  const [maps, query] = await Promise.all([getMaps(), searchParams]);
  const into = typeof query.into === 'string' ? query.into : null;
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [mapsKey, maps],
      ])}
    >
      <ImportPage into={into} />
    </HydrationBoundary>
  );
}
