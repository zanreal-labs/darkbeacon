import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { HydrationBoundary } from '@tanstack/react-query';
import { routes } from '@darkbeacon/shared';
import { isInstanceAdmin, meKey } from '../../../lib/session-keys';
import { getMe, prefilled, serverGet } from '../../../server/api';
import { AdminPage, AdminPageSkeleton, adminKeys } from '../../../screens/AdminPage';
import { SignInRedirect } from '../../../shell/Session';

export const metadata = { title: 'Admin · Darkbeacon' };

/** `/admin`: instance settings, people, plugins and themes (instance owners and admins). */
export default function AdminRoute() {
  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <Admin />
    </Suspense>
  );
}

async function Admin() {
  const me = await getMe();
  if (!me) return <SignInRedirect />;
  if (!isInstanceAdmin(me)) redirect('/');
  // The first tab's data; the other tabs load theirs when opened.
  const [settings, health] = await Promise.all([
    serverGet(routes.admin.settings),
    serverGet(routes.health).catch(() => undefined),
  ]);
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [adminKeys.settings, settings],
        [adminKeys.health, health],
      ])}
    >
      <AdminPage />
    </HydrationBoundary>
  );
}
