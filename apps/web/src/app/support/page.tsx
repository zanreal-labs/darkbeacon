import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SupportScreen } from '../../screens/SupportPage';
import { Skeleton } from '../../ui';

export const metadata: Metadata = {
  title: 'Support · Darkbeacon',
  // The address carries the opener's origin and context; it never leaves as a referrer.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/**
 * `/support`: the support hub's page (tickets, feedback). Other instances open it in a popup;
 * on the hub it opens from the help menu. Not part of the signed-in app: it has its own EVE
 * sign-in.
 */
export default function SupportRoute() {
  return (
    <Suspense fallback={<Skeleton height={320} radius={12} />}>
      <SupportScreen />
    </Suspense>
  );
}
