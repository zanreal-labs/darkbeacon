import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type AuthProvidersDto, type MeDto } from '@wormwright/shared';
import { api, ApiError } from './api';

export const meKey = ['me'] as const;

/** The signed-in account, or null when signed out. Other errors stay errors. */
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
    queryKey: ['auth-providers'],
    queryFn: () => api<AuthProvidersDto>(routes.auth.providers.path),
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogout(everywhere = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<void>(everywhere ? routes.auth.logoutEverywhere.path : routes.auth.logout.path, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
    },
  });
}

export function isInstanceAdmin(me: MeDto | null | undefined): boolean {
  return me?.account.instanceRole === 'owner' || me?.account.instanceRole === 'admin';
}
