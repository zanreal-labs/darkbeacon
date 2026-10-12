import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { buildPath, routes, type AuthProvidersDto, type MeDto, type SessionDto } from '@darkbeacon/shared';
import { api, ApiError } from './api';
import { useOptionalRealtime } from './RealtimeProvider';
import { meKey, providersKey, sessionsKey } from './session-keys';

export { isInstanceAdmin, meKey, providersKey } from './session-keys';

/**
 * The signed-in account, or null when signed out; other errors stay errors. Pages rendered on the
 * server start with it filled in. In demo mode the server signs a visit in before the page renders
 * (the web app's proxy), so there is nothing to do here.
 */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<MeDto | null> => {
      try {
        return await api<MeDto>(routes.accounts.me.path);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthenticated') return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useProviders() {
  return useQuery({
    queryKey: providersKey,
    queryFn: () => api<AuthProvidersDto>(routes.auth.providers.path),
    retry: 1,
    staleTime: Infinity,
  });
}

/** True when the server runs in demo mode (shown as a badge in the shell). */
export function useDemoMode(): boolean {
  return useProviders().data?.demo ?? false;
}

/** Signs in as the demo account again after a sign-out (demo mode only). */
export function useEnterDemo() {
  const queryClient = useQueryClient();
  const realtime = useOptionalRealtime();
  return useMutation({
    // The server also forgets the sign-out it remembered (`dbk_demo_out`).
    mutationFn: () => api<MeDto>(routes.auth.demo.path, { method: 'POST' }),
    onSuccess: (me) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== providersKey[0] });
      queryClient.setQueryData(meKey, me);
      realtime?.reconnect();
    },
  });
}

/** The account's signed-in browsers and devices. */
export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => api<SessionDto[]>(routes.accounts.sessions.path),
  });
}

/** Ends one session (another device); the list refreshes. */
export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api<void>(buildPath(routes.accounts.revokeSession.path, { sessionId }), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export function useLogout(everywhere = false) {
  const queryClient = useQueryClient();
  const realtime = useOptionalRealtime();
  return useMutation({
    mutationFn: () =>
      api<void>(everywhere ? routes.auth.logoutEverywhere.path : routes.auth.logout.path, {
        method: 'POST',
      }),
    // In demo mode the server remembers the sign-out, so the next visit shows the sign-in page.
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== providersKey[0] });
      queryClient.setQueryData(meKey, null);
      // The socket still carries the old session until it reconnects.
      realtime?.reconnect();
    },
  });
}
