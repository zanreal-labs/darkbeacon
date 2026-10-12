import { Suspense, type ReactNode } from 'react';
import { HydrationBoundary } from '@tanstack/react-query';
import { isInstanceAdmin, meKey, providersKey } from '../../lib/session-keys';
import { getMe, getProviders, prefilled } from '../../server/api';
import { AccountMenu } from '../../shell/AccountMenu';
import { AccountPlaceholder, ADMIN_NAV, AppShell, RailLink, TabLink } from '../../shell/AppShell';
import { DemoBadge } from '../../shell/DemoBadge';
import { SessionSync, SignInRedirect } from '../../shell/Session';

/**
 * Every signed-in screen. The frame (rail, top bar, tab bar) is static and prerendered; the
 * parts that need the account stream into it, each behind its own Suspense boundary.
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      account={
        <Suspense fallback={<AccountPlaceholder />}>
          <Account />
        </Suspense>
      }
      adminRail={
        <Suspense fallback={null}>
          <AdminOnly>
            <RailLink item={ADMIN_NAV} />
          </AdminOnly>
        </Suspense>
      }
      adminTab={
        <Suspense fallback={null}>
          <AdminOnly>
            <TabLink item={ADMIN_NAV} />
          </AdminOnly>
        </Suspense>
      }
      demoBadge={
        <Suspense fallback={null}>
          <Demo />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}

/** The account menu; a session the API no longer knows starts over (see SignInRedirect). */
async function Account() {
  const [me, providers] = await Promise.all([getMe(), getProviders()]);
  if (!me) return <SignInRedirect />;
  // Everything the menu reads: a query another boundary fills later would render differently
  // in the browser than on the server (see docs/decisions.md).
  return (
    <HydrationBoundary
      state={prefilled([
        [meKey, me],
        [providersKey, providers],
      ])}
    >
      <SessionSync accountId={me.account.id} />
      <AccountMenu me={me} />
    </HydrationBoundary>
  );
}

async function AdminOnly({ children }: { children: ReactNode }) {
  return isInstanceAdmin(await getMe()) ? children : null;
}

async function Demo() {
  const providers = await getProviders();
  return (
    <HydrationBoundary state={prefilled([[providersKey, providers]])}>
      {providers.demo && <DemoBadge />}
    </HydrationBoundary>
  );
}
