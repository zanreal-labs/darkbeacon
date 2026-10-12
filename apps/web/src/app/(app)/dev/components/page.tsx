import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getProviders } from '../../../../server/api';
import { ComponentGallery } from '../../../../screens/ComponentGallery';
import { Skeleton } from '../../../../ui';

export const metadata = { title: 'Components · Darkbeacon' };

/**
 * `/dev/components`: the design system's gallery, light and dark side by side. Development
 * only: `next dev`, or an instance in demo mode (a preview); a 404 everywhere else.
 */
export default function ComponentsRoute() {
  return (
    <Suspense fallback={<Skeleton width="100%" height={400} />}>
      <Gallery />
    </Suspense>
  );
}

async function Gallery() {
  await connection();
  const dev = process.env.NODE_ENV !== 'production';
  if (!dev && !(await getProviders().catch(() => null))?.demo) notFound();
  return <ComponentGallery />;
}
