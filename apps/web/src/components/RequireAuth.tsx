import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { isInstanceAdmin, useMe } from '../lib/session';

/** Renders children for a signed-in account (and, with `admin`, an instance owner or admin). */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending)
    return (
      <p className="muted" style={{ padding: 'var(--ww-space-4)' }}>
        Loading…
      </p>
    );
  if (me.isError) {
    return (
      <p className="error" style={{ padding: 'var(--ww-space-4)' }}>
        The server cannot be reached right now.
      </p>
    );
  }
  if (!me.data) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?${new URLSearchParams({ next })}`} replace />;
  }
  if (admin && !isInstanceAdmin(me.data)) return <Navigate to="/" replace />;
  return children;
}
