import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '../lib/session';
import { ErrorState, Skeleton } from '../ui';
import { AppShell } from './AppShell';
import { LogoMark } from './Logo';
import styles from './AuthGate.module.css';

/**
 * Route element for every signed-in screen: waits for the account (in demo mode that includes the
 * automatic demo sign-in), sends signed-out visitors to /login and renders the app shell.
 */
export function AuthGate() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <BootScreen />;
  if (me.isError) {
    return (
      <div className={styles.center}>
        <ErrorState title="Can't reach Wormwright" error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  if (!me.data) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?${new URLSearchParams({ next })}`} replace />;
  }
  return (
    <AppShell me={me.data}>
      <Outlet />
    </AppShell>
  );
}

/** Shown for the moment it takes to read the session (or to sign in the demo account). */
function BootScreen() {
  return (
    <div className={styles.boot} aria-busy="true" aria-label="Loading Wormwright">
      <div className={styles.bootRail}>
        <LogoMark size={26} />
      </div>
      <div className={styles.bootTop}>
        <Skeleton width={120} height={12} />
      </div>
    </div>
  );
}
