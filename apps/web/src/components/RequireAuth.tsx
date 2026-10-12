import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { isInstanceAdmin, useMe } from '../lib/session';

/**
 * Inside <AuthGate> the account is known. With `admin`, only an instance owner or admin sees the
 * children; everyone else goes back to the maps.
 */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const me = useMe();
  if (!me.data) return null;
  if (admin && !isInstanceAdmin(me.data)) return <Navigate to="/" replace />;
  return children;
}
