import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { routes, type AuthProvidersDto, type MeDto } from '@wormwright/shared';
import { api, ApiError } from './api';
import { useOptionalRealtime } from './RealtimeProvider';

export const meKey = ['me'] as const;
export const providersKey = ['auth-providers'] as const;

/** Set after an explicit sign-out in demo mode, so the next visit lands on the sign-in page. */
const DEMO_OPT_OUT_KEY = 'ww-demo-signed-out';

function demoOptedOut(): boolean {
  try {
    return sessionStorage.getItem(DEMO_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setDemoOptOut(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(DEMO_OPT_OUT_KEY, '1');
    else sessionStorage.removeItem(DEMO_OPT_OUT_KEY);
  } catch {
    // Without storage, sign-out in demo mode signs straight back in; acceptable for a preview.
  }
}

function fetchProviders(client: QueryClient): Promise<AuthProvidersDto> {
  return client.fetchQuery({
    queryKey: providersKey,
    queryFn: () => api<AuthProvidersDto>(routes.auth.providers.path),
    staleTime: Infinity,
  });
}

/**
 * The signed-in account, or null when signed out. Other errors stay errors. In demo mode an
 * unauthenticated visit is signed in as the demo account on the spot.
 */
export function useMe() {
  const client = useQueryClient();
  const realtime = useOptionalRealtime();
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<MeDto | null> => {
      try {
        return await api<MeDto>(routes.accounts.me.path);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'unauthenticated') throw error;
      }
      if (demoOptedOut()) return null;
      const providers = await fetchProviders(client);
      if (!providers.demo) return null;
      const me = await api<MeDto>(routes.auth.demo.path, { method: 'POST' });
      // The socket opened before the session cookie existed; open it again as the demo account.
      realtime?.reconnect();
      return me;
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
    mutationFn: () => {
      setDemoOptOut(false);
      return api<MeDto>(routes.auth.demo.path, { method: 'POST' });
    },
    onSuccess: (me) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== providersKey[0] });
      queryClient.setQueryData(meKey, me);
      realtime?.reconnect();
    },
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
    onSuccess: () => {
      setDemoOptOut(true);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== providersKey[0] });
      queryClient.setQueryData(meKey, null);
      // The socket still carries the old session until it reconnects.
      realtime?.reconnect();
    },
  });
}

export function isInstanceAdmin(me: MeDto | null | undefined): boolean {
  return me?.account.instanceRole === 'owner' || me?.account.instanceRole === 'admin';
}
